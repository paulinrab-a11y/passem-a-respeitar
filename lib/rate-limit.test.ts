import { afterEach, describe, expect, it, vi } from 'vitest';
import { ipDoRequest, limita } from './rate-limit';

// O modulo guarda as janelas num Map de escopo de modulo, que sobrevive entre
// testes. Cada teste usa a propria chave para nao herdar contagem do vizinho.
let n = 0;
const chave = () => `teste-${n++}`;

afterEach(() => {
  vi.useRealTimers();
});

describe('limita', () => {
  it('permite ate o maximo e bloqueia a proxima', () => {
    const k = chave();
    for (let i = 0; i < 3; i++) {
      expect(limita(k, 3, 60_000).permitido).toBe(true);
    }
    expect(limita(k, 3, 60_000).permitido).toBe(false);
  });

  it('conta quantas sobram', () => {
    const k = chave();
    expect(limita(k, 3, 60_000).restantes).toBe(2);
    expect(limita(k, 3, 60_000).restantes).toBe(1);
    expect(limita(k, 3, 60_000).restantes).toBe(0);
  });

  it('diz quanto falta esperar quando bloqueia', () => {
    const k = chave();
    limita(k, 1, 60_000);
    const bloqueado = limita(k, 1, 60_000);
    expect(bloqueado.permitido).toBe(false);
    expect(bloqueado.esperarS).toBeGreaterThan(0);
    expect(bloqueado.esperarS).toBeLessThanOrEqual(60);
  });

  it('nunca manda esperar zero segundo', () => {
    const k = chave();
    // Janela de 1ms: sem o piso de 1s, o arredondamento daria 0 e o cliente
    // tentaria de novo no mesmo instante, em laco.
    limita(k, 1, 1);
    vi.useFakeTimers();
    const bloqueado = limita(k, 1, 1);
    if (!bloqueado.permitido) expect(bloqueado.esperarS).toBeGreaterThanOrEqual(1);
  });

  it('libera quando a janela passa', () => {
    const k = chave();
    limita(k, 1, 60_000);
    expect(limita(k, 1, 60_000).permitido).toBe(false);

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 61_000);
    expect(limita(k, 1, 60_000).permitido).toBe(true);
  });

  // O Map so e varrido quando passa de 5000 entradas. Sem essa limpeza, uma
  // instancia de vida longa acumula uma entrada por IP para sempre.
  it('limpa janelas vencidas quando o mapa cresce', () => {
    for (let i = 0; i < 5100; i++) limita(`enchendo-${i}`, 1, 1);

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 1000);

    // Este chamado dispara a varredura. O que importa e que ela nao derrube
    // nada e que a chave nova continue funcionando.
    const k = chave();
    expect(limita(k, 2, 60_000).permitido).toBe(true);
    expect(limita(k, 2, 60_000).permitido).toBe(true);
    expect(limita(k, 2, 60_000).permitido).toBe(false);
  });

  it('nao mistura chaves diferentes', () => {
    const a = chave();
    const b = chave();
    limita(a, 1, 60_000);
    expect(limita(a, 1, 60_000).permitido).toBe(false);
    expect(limita(b, 1, 60_000).permitido).toBe(true);
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

  // Sem cabecalho, todo mundo cai no mesmo balde. E restritivo demais de
  // proposito: limitar demais e melhor que nao limitar.
  it('usa um balde unico quando nao ha cabecalho', () => {
    expect(ipDoRequest(new Headers())).toBe('desconhecido');
  });
});
