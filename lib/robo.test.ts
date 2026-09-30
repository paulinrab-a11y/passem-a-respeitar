import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { desafioConfere, pareceRobo, RECUSA } from './robo';

/**
 * Protecao contra bot (#28). O que se prova aqui:
 *
 *   - a isca recusa sozinha, com ou sem chave
 *   - sem token nao ha conversa, e nada sai para a Cloudflare
 *   - quem decide e a resposta da Cloudflare, e so o `success: true` com a
 *     acao certa passa
 *   - qualquer falha da conferencia recusa: nunca "deixa passar"
 */

const captureMessage = vi.fn();
vi.mock('@sentry/nextjs', () => ({
  captureMessage: (...a: unknown[]) => captureMessage(...a),
  flush: async () => true,
}));

// Inventadas. As de verdade nunca entram num teste.
const CHAVE = 'chave-publica-de-teste';
const SEGREDO = 'segredo-de-teste';
const TOKEN = 'token-de-teste';

const pedido = vi.fn<typeof fetch>();

function responde(corpo: unknown) {
  pedido.mockResolvedValue(new Response(JSON.stringify(corpo)));
}

function ligada() {
  vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', CHAVE);
  vi.stubEnv('TURNSTILE_SECRET_KEY', SEGREDO);
}

function mandado() {
  const [url, opcoes] = pedido.mock.calls[0];
  return { url, corpo: opcoes?.body as URLSearchParams, metodo: opcoes?.method };
}

function avisos() {
  return captureMessage.mock.calls.map(([, o]) => o.tags.motivo);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', pedido);
  vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', '');
  vi.stubEnv('TURNSTILE_SECRET_KEY', '');
  vi.stubEnv('VERCEL_ENV', '');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('a isca', () => {
  it.each([null, undefined, ''])('vazia (%j) e o esperado', async (isca) => {
    expect(await pareceRobo({ isca, desafio: null })).toBe(false);
  });

  it.each(['https://spam.invalid', ' ', '0', 0, false, ['x'], {}])(
    'preenchida (%j) recusa',
    async (isca) => {
      expect(await pareceRobo({ isca, desafio: TOKEN })).toBe(true);
    }
  );

  it('recusa com a protecao ligada e token bom tambem', async () => {
    ligada();
    expect(await pareceRobo({ isca: 'x', desafio: TOKEN })).toBe(true);
  });

  it('nao gasta chamada nenhuma', async () => {
    ligada();
    await pareceRobo({ isca: 'x', desafio: TOKEN });
    expect(pedido).not.toHaveBeenCalled();
  });
});

describe('o token, antes da conferencia', () => {
  beforeEach(ligada);

  it('presente passa para a etapa seguinte', async () => {
    expect(await pareceRobo({ isca: '', desafio: TOKEN })).toBe(false);
  });

  it.each([null, undefined, '', 0, ['a'], {}, new Blob(['a'])])(
    'ausente ou de tipo errado (%j) recusa',
    async (desafio) => {
      expect(await pareceRobo({ isca: '', desafio })).toBe(true);
    }
  );

  it('gigante recusa sem ir a Cloudflare', async () => {
    expect(await pareceRobo({ isca: '', desafio: 'a'.repeat(2049) })).toBe(true);
    expect(await pareceRobo({ isca: '', desafio: 'a'.repeat(2048) })).toBe(false);
    expect(pedido).not.toHaveBeenCalled();
  });
});

describe('sem as chaves', () => {
  it('fora de producao o desafio fica desligado, e a isca continua', async () => {
    expect(await pareceRobo({ isca: '', desafio: null })).toBe(false);
    expect(await desafioConfere(null, 'entrar', '203.0.113.1')).toBe(true);
    expect(await pareceRobo({ isca: 'x', desafio: null })).toBe(true);
    expect(pedido).not.toHaveBeenCalled();
  });

  it('uma chave so nao liga nada', async () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', SEGREDO);
    expect(await desafioConfere(TOKEN, 'entrar', '203.0.113.1')).toBe(true);
    expect(pedido).not.toHaveBeenCalled();
  });

  it('em producao recusa tudo e avisa', async () => {
    vi.stubEnv('VERCEL_ENV', 'production');

    expect(await pareceRobo({ isca: '', desafio: TOKEN })).toBe(true);
    expect(await desafioConfere(TOKEN, 'entrar', '203.0.113.1')).toBe(false);
    expect(avisos()).toEqual(['sem-chave']);
    expect(pedido).not.toHaveBeenCalled();
  });

  it('em producao, uma chave so tambem recusa', async () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', CHAVE);

    expect(await pareceRobo({ isca: '', desafio: TOKEN })).toBe(true);
    expect(await desafioConfere(TOKEN, 'entrar', '203.0.113.1')).toBe(false);
  });
});

describe('a conferencia', () => {
  beforeEach(ligada);

  it('pergunta a Cloudflare, com o segredo, o token e o IP', async () => {
    responde({ success: true, action: 'entrar' });

    expect(await desafioConfere(TOKEN, 'entrar', '203.0.113.7')).toBe(true);

    const { url, corpo, metodo } = mandado();
    expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    expect(metodo).toBe('POST');
    expect(Object.fromEntries(corpo)).toEqual({
      secret: SEGREDO,
      response: TOKEN,
      remoteip: '203.0.113.7',
    });
  });

  it('sem IP conhecido, nao manda IP', async () => {
    responde({ success: true, action: 'entrar' });
    await desafioConfere(TOKEN, 'entrar', 'desconhecido');
    expect(mandado().corpo.has('remoteip')).toBe(false);
  });

  it.each([
    ['token vencido ou repetido', { success: false, 'error-codes': ['timeout-or-duplicate'] }],
    ['token inventado', { success: false, 'error-codes': ['invalid-input-response'] }],
    ['success que nao e true', { success: 'true', action: 'entrar' }],
    ['resposta vazia', {}],
    ['token de outro formulario', { success: true, action: 'convite' }],
    ['token sem acao', { success: true }],
  ])('%s recusa, sem aviso', async (_, corpo) => {
    responde(corpo);

    expect(await desafioConfere(TOKEN, 'entrar', '203.0.113.1')).toBe(false);
    expect(captureMessage).not.toHaveBeenCalled();
  });

  it.each(['invalid-input-secret', 'missing-input-secret', 'bad-request'])(
    'erro que e nosso (%s) recusa e avisa',
    async (codigo) => {
      responde({ success: false, 'error-codes': [codigo] });

      expect(await desafioConfere(TOKEN, 'entrar', '203.0.113.1')).toBe(false);
      expect(avisos()).toEqual([codigo]);
    }
  );

  it('Cloudflare fora do ar recusa e avisa', async () => {
    pedido.mockRejectedValue(new Error('ECONNRESET'));

    expect(await desafioConfere(TOKEN, 'entrar', '203.0.113.1')).toBe(false);
    expect(avisos()).toEqual(['fora-do-ar']);
  });

  it('resposta que nao e JSON recusa e avisa', async () => {
    pedido.mockResolvedValue(new Response('<html>502</html>', { status: 502 }));

    expect(await desafioConfere(TOKEN, 'entrar', '203.0.113.1')).toBe(false);
    expect(avisos()).toEqual(['fora-do-ar']);
  });

  it('tem prazo: nao segura o formulario esperando a Cloudflare', async () => {
    responde({ success: true, action: 'entrar' });
    await desafioConfere(TOKEN, 'entrar', '203.0.113.1');
    expect(pedido.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([null, undefined, '', 0])('sem token (%j) nem pergunta', async (desafio) => {
    expect(await desafioConfere(desafio, 'entrar', '203.0.113.1')).toBe(false);
    expect(pedido).not.toHaveBeenCalled();
  });

  it('nada do que avisa leva o token, o segredo ou o IP', async () => {
    pedido.mockRejectedValue(new Error('ECONNRESET'));
    await desafioConfere(TOKEN, 'entrar', '203.0.113.9');

    const texto = JSON.stringify(captureMessage.mock.calls);
    expect(texto).not.toContain(TOKEN);
    expect(texto).not.toContain(SEGREDO);
    expect(texto).not.toContain('203.0.113.9');
  });
});

describe('as chaves de teste da Cloudflare', () => {
  beforeEach(ligada);

  // Medido em 29/09/2026: o segredo de teste aceita qualquer token, e a
  // resposta nao traz `action`.
  const DE_TESTE = { success: true, metadata: { result_with_testing_key: true } };

  it('fora de producao valem, mesmo sem acao na resposta', async () => {
    responde(DE_TESTE);
    expect(await desafioConfere(TOKEN, 'entrar', '203.0.113.1')).toBe(true);
  });

  it('em producao recusam e avisam', async () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    responde(DE_TESTE);

    expect(await desafioConfere(TOKEN, 'entrar', '203.0.113.1')).toBe(false);
    expect(avisos()).toEqual(['chave-de-teste']);
  });
});

describe('a mensagem', () => {
  it('e uma so, e nao diz qual barreira recusou', () => {
    expect(RECUSA).not.toMatch(/token|isca|campo|cloudflare|turnstile|chave/i);
  });
});
