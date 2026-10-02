import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assinaResposta } from '@/lib/concierge/voz';
import { POST } from './route';

/**
 * A rota da voz (#193): limite, formato, assinatura, e so entao o Gemini,
 * que aqui e um `fetch` falso.
 */

vi.mock('@sentry/nextjs', () => ({
  captureMessage: () => undefined,
  flush: async () => true,
}));

// Inventada. A de verdade nunca entra num teste.
const CHAVE = 'chave-de-teste';
const TEXTO = 'Dia 20, mano.';

const pedido = vi.fn<typeof fetch>();

function geminiFala() {
  const data = Buffer.from(new Uint8Array([1, 2, 3, 4])).toString('base64');
  pedido.mockImplementation(
    async () =>
      new Response(
        JSON.stringify({
          candidates: [
            { content: { parts: [{ inlineData: { mimeType: 'audio/L16;rate=24000', data } }] } },
          ],
        })
      )
  );
}

/** IP novo por caso: o rate limit guarda estado no modulo. */
let n = 0;
function pede(corpo: unknown, ip = `203.0.113.${n++ % 250}`) {
  return new Request('https://passem-a-respeitar.test/api/concierge/voz', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo),
  });
}

async function assinado(texto = TEXTO) {
  return { texto, assinatura: await assinaResposta(texto) };
}

beforeEach(() => {
  vi.stubGlobal('fetch', pedido);
  vi.stubEnv('GEMINI_API_KEY', CHAVE);
  pedido.mockReset();
  geminiFala();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('POST /api/concierge/voz', () => {
  it('fala texto assinado e devolve WAV sem cache', async () => {
    const r = await POST(pede(await assinado()));
    const bytes = new Uint8Array(await r.arrayBuffer());

    expect(r.status).toBe(200);
    expect(r.headers.get('Content-Type')).toBe('audio/wav');
    expect(r.headers.get('Cache-Control')).toBe('no-store');
    expect(String.fromCharCode(...bytes.subarray(0, 4))).toBe('RIFF');
    expect(bytes.length).toBe(48);
  });

  it('o 11o audio do mesmo IP leva 429, e nada sai para o Gemini', async () => {
    const ip = '198.51.100.193';
    for (let i = 0; i < 10; i++) {
      expect((await POST(pede(await assinado(), ip))).status).toBe(200);
    }
    pedido.mockClear();

    const r = await POST(pede(await assinado(), ip));
    expect(r.status).toBe(429);
    expect(r.headers.get('Retry-After')).toMatch(/^\d+$/);
    expect(pedido).not.toHaveBeenCalled();
  });

  it.each([
    ['assinatura de outro texto', async () => ({ ...(await assinado('Outro.')), texto: TEXTO })],
    [
      'assinatura forjada',
      async () => ({ texto: TEXTO, assinatura: `v1.9999999999.${'0'.repeat(64)}` }),
    ],
  ])('%s leva 403 sem chamar o Gemini', async (_nome, corpo) => {
    const r = await POST(pede(await corpo()));
    expect(r.status).toBe(403);
    expect(pedido).not.toHaveBeenCalled();
  });

  it.each([
    ['sem assinatura', { texto: TEXTO }],
    ['sem texto', { assinatura: 'v1.1.a' }],
    ['texto gigante', { texto: 'a'.repeat(1201), assinatura: 'v1.1.a' }],
    ['lista', [TEXTO]],
  ])('recusa %s com 400', async (_nome, corpo) => {
    const r = await POST(pede(corpo));
    expect(r.status).toBe(400);
    expect(pedido).not.toHaveBeenCalled();
  });

  it('recusa corpo que nem e JSON', async () => {
    expect((await POST(pede('nao-e-json'))).status).toBe(400);
  });

  it('erro do Gemini vira 502 sem o texto do erro original', async () => {
    const corpo = await assinado();
    const erro = JSON.stringify({ error: { message: 'quota exceeded' } });
    pedido.mockImplementation(async () => new Response(erro, { status: 429 }));

    const r = await POST(pede(corpo));
    const texto = JSON.stringify(await r.json());

    expect(r.status).toBe(502);
    expect(texto).not.toContain('quota exceeded');
    expect(texto).not.toContain(CHAVE);
  });

  it('sem chave, nenhuma assinatura vale e nada sai para o Google', async () => {
    const corpo = await assinado();
    vi.stubEnv('GEMINI_API_KEY', '');

    const r = await POST(pede(corpo));
    expect(r.status).toBe(403);
    expect(pedido).not.toHaveBeenCalled();
  });
});
