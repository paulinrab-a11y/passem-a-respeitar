import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, POST } from './route';

// Codigo inventado. O real nunca entra num teste, nem o hash dele: este
// repositorio e publico e hash de codigo curto cai em dicionario.
const CODIGO = 'CODIGO-DE-TESTE';
const SEGREDO = 'segredo-de-teste';

/** O hash de verdade do CODIGO, calculado na hora para nao ficar desatualizado. */
async function hashDoCodigo() {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(CODIGO));
  return Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

let cookieDoRequest: string | undefined;

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (nome: string) =>
      nome === 'par_convite' && cookieDoRequest ? { value: cookieDoRequest } : undefined,
  }),
}));

/** IP novo por caso: o rate limit guarda estado no modulo. */
let n = 0;
function pede(corpo: unknown, ip = `203.0.113.${n++ % 250}`) {
  return new Request('https://passem-a-respeitar.test/api/convite', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo),
  });
}

beforeEach(async () => {
  vi.stubEnv('CONVITE_CODIGOS_HASH', await hashDoCodigo());
  vi.stubEnv('CONVITE_COOKIE_SECRET', SEGREDO);
  vi.stubEnv('CONVITE_TEASER_EMBED', 'https://exemplo.invalid/teaser');
  cookieDoRequest = undefined;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('POST', () => {
  it('aceita o codigo certo e devolve o teaser', async () => {
    const r = await POST(pede({ codigo: CODIGO }));
    const corpo = await r.json();

    expect(r.status).toBe(200);
    expect(corpo.ok).toBe(true);
    expect(corpo.teaser).toBe('https://exemplo.invalid/teaser');
  });

  it('emite o cookie assinado, httpOnly', async () => {
    const r = await POST(pede({ codigo: CODIGO }));
    const cookie = r.cookies.get('par_convite');

    expect(cookie?.value).toMatch(/^v1\.\d+\.[0-9a-f]{64}$/);
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe('lax');
  });

  it('normaliza caixa e espaco', async () => {
    const r = await POST(pede({ codigo: `  ${CODIGO.toLowerCase()}  ` }));
    expect(r.status).toBe(200);
  });

  // Mensagem e status identicos para codigo errado, formato invalido e corpo
  // quebrado. Diferenca aqui vira oraculo: o atacante aprende o formato do
  // codigo so de ler a resposta.
  it.each([
    ['codigo errado', { codigo: 'NAO-E-O-CODIGO' }],
    ['codigo vazio', { codigo: '' }],
    ['codigo gigante', { codigo: 'A'.repeat(33) }],
    ['codigo que nao e texto', { codigo: 42 }],
    ['sem campo codigo', { outro: 'coisa' }],
  ])('recusa %s com a mesma mensagem', async (_nome, corpo) => {
    const r = await POST(pede(corpo));
    const json = await r.json();

    expect(r.status).toBe(401);
    expect(json).toEqual({ ok: false, erro: 'Esse código não abre nada aqui.' });
    expect(r.cookies.get('par_convite')).toBeUndefined();
  });

  it('recusa corpo que nem e JSON', async () => {
    const r = await POST(pede('nao-e-json'));
    expect(r.status).toBe(400);
    expect((await r.json()).erro).toBe('Esse código não abre nada aqui.');
  });

  // Falha fechada: sem hash configurado, nenhum codigo abre nada. O contrario
  // — aceitar tudo quando a variavel some — seria a pior falha possivel aqui.
  it('recusa tudo quando nao ha hash configurado', async () => {
    vi.stubEnv('CONVITE_CODIGOS_HASH', '');
    const r = await POST(pede({ codigo: CODIGO }));
    expect(r.status).toBe(401);
  });

  it('bloqueia depois de oito tentativas do mesmo IP', async () => {
    const ip = '198.51.100.77';

    for (let i = 0; i < 8; i++) {
      const r = await POST(pede({ codigo: 'errado' }, ip));
      expect(r.status).toBe(401);
    }

    const bloqueado = await POST(pede({ codigo: CODIGO }, ip));
    expect(bloqueado.status).toBe(429);
    expect(bloqueado.headers.get('Retry-After')).toMatch(/^\d+$/);
  });

  it('o bloqueio de um IP nao atinge outro', async () => {
    for (let i = 0; i < 9; i++) await POST(pede({ codigo: 'errado' }, '198.51.100.88'));

    const outro = await POST(pede({ codigo: CODIGO }, '198.51.100.89'));
    expect(outro.status).toBe(200);
  });
});

describe('GET', () => {
  it('devolve o teaser para quem tem cookie valido', async () => {
    const emitido = await POST(pede({ codigo: CODIGO }));
    cookieDoRequest = emitido.cookies.get('par_convite')?.value;

    const r = await GET();
    expect(r.status).toBe(200);
    expect((await r.json()).teaser).toBe('https://exemplo.invalid/teaser');
  });

  it('recusa quem nao tem cookie', async () => {
    const r = await GET();
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ ok: false });
  });

  it('recusa cookie forjado', async () => {
    // v1 com expiracao no futuro e assinatura inventada: e exatamente o que
    // alguem tentaria montar a mao para pular o codigo.
    cookieDoRequest = `v1.${Math.floor(Date.now() / 1000) + 9999}.${'0'.repeat(64)}`;

    const r = await GET();
    expect(r.status).toBe(401);
  });

  // Se a verificacao de HMAC nao estivesse acontecendo, este passaria.
  it('recusa cookie assinado com outro segredo', async () => {
    vi.stubEnv('CONVITE_COOKIE_SECRET', 'segredo-do-atacante');
    const doAtacante = await POST(pede({ codigo: CODIGO }));
    cookieDoRequest = doAtacante.cookies.get('par_convite')?.value;

    vi.stubEnv('CONVITE_COOKIE_SECRET', SEGREDO);
    const r = await GET();
    expect(r.status).toBe(401);
  });

  it('nao vaza o teaser sem cookie', async () => {
    const r = await GET();
    expect(JSON.stringify(await r.json())).not.toContain('exemplo.invalid');
  });
});
