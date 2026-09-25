import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Duas implementacoes atras de `limita()`. O que se prova aqui:
 *
 *   - sem credencial, a memoria funciona como sempre funcionou
 *   - com credencial, o Upstash decide, e a contagem e compartilhada
 *   - Redis fora do ar ou lento NAO deixa passar: cai na memoria
 *
 * O SDK e dublado com um contador em Map: o que interessa e o contrato, nao
 * o algoritmo de janela deslizante, que e deles.
 */

/** Contador compartilhado que simula o Redis: duas "instancias" veem o mesmo. */
const contadores = new Map<string, number>();
let falhaNoRedis: 'nao' | 'lanca' | 'timeout' = 'nao';
const construidos: { maximo: number; janela: string; prefix: string }[] = [];

vi.mock('@upstash/redis', () => ({ Redis: class {} }));
vi.mock('@upstash/ratelimit', () => {
  class Ratelimit {
    static slidingWindow(maximo: number, janela: string) {
      return { maximo, janela };
    }
    private readonly maximo: number;
    private readonly prefix: string;
    constructor(o: { limiter: { maximo: number; janela: string }; prefix: string }) {
      this.maximo = o.limiter.maximo;
      this.prefix = o.prefix;
      construidos.push({ maximo: o.limiter.maximo, janela: o.limiter.janela, prefix: o.prefix });
    }
    async limit(id: string) {
      if (falhaNoRedis === 'lanca') throw new Error('ECONNRESET');
      if (falhaNoRedis === 'timeout') {
        return { success: true, remaining: this.maximo, reset: Date.now(), reason: 'timeout' };
      }
      const k = `${this.prefix}:${id}`;
      const n = (contadores.get(k) ?? 0) + 1;
      contadores.set(k, n);
      return {
        success: n <= this.maximo,
        remaining: Math.max(0, this.maximo - n),
        reset: Date.now() + 15_000,
        reason: undefined,
      };
    }
  }
  return { Ratelimit };
});

const { ipDoRequest, limita } = await import('./rate-limit');

// O modulo guarda as janelas num Map de escopo de modulo, que sobrevive entre
// testes. Cada teste usa a propria chave para nao herdar contagem do vizinho.
let n = 0;
const chave = () => `teste-${n++}`;

beforeEach(() => {
  contadores.clear();
  construidos.length = 0;
  falhaNoRedis = 'nao';
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('sem credencial: memoria', () => {
  beforeEach(() => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
  });

  it('permite ate o maximo e bloqueia a proxima', async () => {
    const k = chave();
    for (let i = 0; i < 3; i++) {
      expect((await limita(k, 3, 60_000)).permitido).toBe(true);
    }
    expect((await limita(k, 3, 60_000)).permitido).toBe(false);
    expect(construidos).toEqual([]);
  });

  it('conta quantas sobram', async () => {
    const k = chave();
    expect((await limita(k, 3, 60_000)).restantes).toBe(2);
    expect((await limita(k, 3, 60_000)).restantes).toBe(1);
    expect((await limita(k, 3, 60_000)).restantes).toBe(0);
  });

  it('diz quanto falta esperar quando bloqueia', async () => {
    const k = chave();
    await limita(k, 1, 60_000);
    const bloqueado = await limita(k, 1, 60_000);
    expect(bloqueado.permitido).toBe(false);
    expect(bloqueado.esperarS).toBeGreaterThan(0);
    expect(bloqueado.esperarS).toBeLessThanOrEqual(60);
  });

  it('nunca manda esperar zero segundo', async () => {
    const k = chave();
    await limita(k, 1, 1);
    vi.useFakeTimers();
    const bloqueado = await limita(k, 1, 1);
    if (!bloqueado.permitido) expect(bloqueado.esperarS).toBeGreaterThanOrEqual(1);
  });

  it('libera quando a janela passa', async () => {
    const k = chave();
    await limita(k, 1, 60_000);
    expect((await limita(k, 1, 60_000)).permitido).toBe(false);

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 61_000);
    expect((await limita(k, 1, 60_000)).permitido).toBe(true);
  });

  it('limpa janelas vencidas quando o mapa cresce', async () => {
    for (let i = 0; i < 5100; i++) await limita(`enchendo-${i}`, 1, 1);

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 1000);

    const k = chave();
    expect((await limita(k, 2, 60_000)).permitido).toBe(true);
    expect((await limita(k, 2, 60_000)).permitido).toBe(true);
    expect((await limita(k, 2, 60_000)).permitido).toBe(false);
  });

  it('nao mistura chaves diferentes', async () => {
    const a = chave();
    const b = chave();
    await limita(a, 1, 60_000);
    expect((await limita(a, 1, 60_000)).permitido).toBe(false);
    expect((await limita(b, 1, 60_000)).permitido).toBe(true);
  });
});

describe('com credencial: Upstash', () => {
  beforeEach(() => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://exemplo.upstash.io');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'token-de-teste');
  });

  it('o Upstash decide, com o maximo e a janela pedidos', async () => {
    const k = chave();
    for (let i = 0; i < 3; i++) expect((await limita(k, 3, 15 * 60_000)).permitido).toBe(true);
    const bloqueado = await limita(k, 3, 15 * 60_000);

    expect(bloqueado.permitido).toBe(false);
    expect(bloqueado.esperarS).toBeGreaterThanOrEqual(1);
    expect(construidos[0]).toMatchObject({ maximo: 3, janela: '900000 ms' });
  });

  // O motivo de existir (#121): duas instancias serverless, um contador.
  it('a contagem e compartilhada entre "instancias"', async () => {
    const k = chave();
    // Instancia A gasta duas; instancia B ve as duas gastas.
    await limita(k, 3, 60_000);
    await limita(k, 3, 60_000);
    const naOutra = await limita(k, 3, 60_000);
    expect(naOutra.restantes).toBe(0);
    expect((await limita(k, 3, 60_000)).permitido).toBe(false);
  });

  it('um limitador por par (maximo, janela), com prefixo proprio', async () => {
    const k = chave();
    await limita(k, 5, 60_000);
    await limita(k, 5, 60_000);
    await limita(k, 1, 60_000);

    expect(construidos.map((c) => c.prefix)).toEqual(['par:5:60000', 'par:1:60000']);
  });

  it('a mesma chave com limites diferentes nao divide contador', async () => {
    const k = chave();
    await limita(k, 1, 60_000);
    expect((await limita(k, 1, 60_000)).permitido).toBe(false);
    expect((await limita(k, 10, 60_000)).permitido).toBe(true);
  });

  // Falhar aberto nunca. Redis fora do ar = limite local, nao "sem limite".
  it('Redis fora do ar cai na memoria e continua limitando', async () => {
    falhaNoRedis = 'lanca';
    const k = chave();
    expect((await limita(k, 1, 60_000)).permitido).toBe(true);
    expect((await limita(k, 1, 60_000)).permitido).toBe(false);
    expect(console.warn).toHaveBeenCalledWith(expect.stringMatching(/Redis indisponivel/));
  });

  // O SDK "deixa passar" no timeout. Aqui nao.
  it('timeout do Redis tambem cai na memoria, sem deixar passar', async () => {
    falhaNoRedis = 'timeout';
    const k = chave();
    expect((await limita(k, 1, 60_000)).permitido).toBe(true);
    expect((await limita(k, 1, 60_000)).permitido).toBe(false);
  });
});

describe('ipDoRequest', () => {
  it('pega o primeiro de x-forwarded-for', () => {
    const h = new Headers({ 'x-forwarded-for': '203.0.113.7, 70.41.3.18, 150.172.238.178' });
    expect(ipDoRequest(h)).toBe('203.0.113.7');
  });

  it('tira espaco em volta', () => {
    expect(ipDoRequest(new Headers({ 'x-forwarded-for': '  203.0.113.7  ' }))).toBe('203.0.113.7');
  });

  it('cai para x-real-ip', () => {
    expect(ipDoRequest(new Headers({ 'x-real-ip': '203.0.113.9' }))).toBe('203.0.113.9');
  });

  it('prefere x-forwarded-for quando os dois vem', () => {
    const h = new Headers({ 'x-forwarded-for': '203.0.113.7', 'x-real-ip': '203.0.113.9' });
    expect(ipDoRequest(h)).toBe('203.0.113.7');
  });

  it('usa um balde unico quando nao ha cabecalho', () => {
    expect(ipDoRequest(new Headers())).toBe('desconhecido');
  });
});
