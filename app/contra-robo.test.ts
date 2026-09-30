import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { limita } from '@/lib/rate-limit';
import { RECUSA } from '@/lib/robo';

/**
 * Os quatro formularios publicos, atras da protecao contra bot (#28).
 *
 * O mesmo contrato, conferido nos quatro de uma vez — login, cadastro,
 * recuperacao de senha e convite:
 *
 *   - isca preenchida ou envio sem token: recusa, e nada acontece
 *   - token que a Cloudflare recusa: recusa, e nada acontece
 *   - token que a Cloudflare aceita: o formulario segue
 *   - a recusa e a mesma frase nos quatro, e nao conta nada sobre a conta
 *
 * "Nada acontece" e literal: o Supabase nao e chamado, e-mail nao sai, codigo
 * de convite nao e conferido.
 */

const auth = {
  signInWithPassword: vi.fn(async (_: unknown) => ({ error: null })),
  signUp: vi.fn(async (_: unknown) => ({ data: { session: null }, error: null })),
  resetPasswordForEmail: vi.fn(async (..._: unknown[]) => ({ error: null })),
};
const codigoConfere = vi.fn(async (_: string) => false);
let cabecalhos = new Headers();

vi.mock('@/lib/supabase/servidor', () => ({ clienteDeAuth: async () => ({ auth }) }));
vi.mock('@/lib/conta/senha-servidor', () => ({ senhaVazada: async () => false }));
vi.mock('@sentry/nextjs', () => ({ captureMessage: vi.fn(), flush: async () => true }));
vi.mock('next/headers', () => ({
  cookies: async () => ({ set: vi.fn(), get: () => undefined }),
  headers: async () => cabecalhos,
}));
vi.mock('next/navigation', () => ({
  redirect: (destino: string) => {
    throw new Error(`redirect:${destino}`);
  },
}));
vi.mock('@/lib/convite', async (original) => ({
  ...(await original<typeof import('@/lib/convite')>()),
  codigoConfere: (codigo: string) => codigoConfere(codigo),
}));

const { entrar } = await import('./entrar/acoes');
const { estadoInicial } = await import('./entrar/estado');
const { criarConta } = await import('./criar-conta/acoes');
const { criarContaInicial } = await import('./criar-conta/estado');
const { recuperarSenha } = await import('./recuperar-senha/acoes');
const { recuperarInicial } = await import('./recuperar-senha/estado');
const { POST: convite } = await import('./api/convite/route');

// Inventadas. As de verdade nunca entram num teste.
const TOKEN = 'token-de-teste';
const pedido = vi.fn<typeof fetch>();

let n = 0;
let ip = '';
const email = () => `pessoa${n}@exemplo.invalid`;

type Extra = { desafio?: string; isca?: string };
type Resposta = { recusado: boolean; mensagem: string | null };

function formulario(campos: Record<string, string>, { desafio, isca }: Extra) {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.set(k, v);
  if (desafio !== undefined) f.set('cf-turnstile-response', desafio);
  if (isca !== undefined) f.set('website', isca);
  return f;
}

/**
 * Cada formulario, com dados que passariam: o que recusar aqui e a protecao
 * contra bot, e mais nada.
 */
const FORMULARIOS = [
  {
    nome: 'login',
    acao: 'entrar',
    limite: () => `entrar:ip:${ip}`,
    andou: () => auth.signInWithPassword.mock.calls.length > 0,
    async envia(extra: Extra): Promise<Resposta> {
      try {
        const r = await entrar(
          estadoInicial,
          formulario({ email: email(), senha: 'a senha certa' }, extra)
        );
        return { recusado: true, mensagem: r.erro };
      } catch (e) {
        // `redirect` lanca: e o login que deu certo.
        if (!String(e).includes('redirect:')) throw e;
        return { recusado: false, mensagem: null };
      }
    },
  },
  {
    nome: 'cadastro',
    acao: 'criar-conta',
    limite: () => `criar:ip:${ip}`,
    andou: () => auth.signUp.mock.calls.length > 0,
    async envia(extra: Extra): Promise<Resposta> {
      const r = await criarConta(
        criarContaInicial,
        formulario(
          {
            nome: 'Fulana',
            email: email(),
            senha: 'uma senha razoavel',
            confirmacao: 'uma senha razoavel',
            aceite: 'on',
          },
          extra
        )
      );
      return { recusado: r.enviadoPara === null, mensagem: r.erro };
    },
  },
  {
    nome: 'recuperacao de senha',
    acao: 'recuperar-senha',
    limite: () => `recuperar:ip:${ip}`,
    andou: () => auth.resetPasswordForEmail.mock.calls.length > 0,
    async envia(extra: Extra): Promise<Resposta> {
      const r = await recuperarSenha(recuperarInicial, formulario({ email: email() }, extra));
      return { recusado: !r.enviado, mensagem: r.erro };
    },
  },
  {
    nome: 'convite',
    acao: 'convite',
    limite: () => `convite:${ip}`,
    andou: () => codigoConfere.mock.calls.length > 0,
    async envia({ desafio, isca }: Extra): Promise<Resposta> {
      const r = await convite(
        new Request('https://passem-a-respeitar.test/api/convite', {
          method: 'POST',
          headers: cabecalhos,
          body: JSON.stringify({ codigo: 'CODIGO-DE-TESTE', desafio, website: isca }),
        })
      );
      const corpo = await r.json();
      // 401 e a resposta do codigo: o envio passou pela protecao e pelo limite.
      return { recusado: r.status !== 401, mensagem: corpo.erro ?? null };
    },
  },
] as const;

function cloudflare(corpo: unknown) {
  pedido.mockImplementation(async () => new Response(JSON.stringify(corpo)));
}

function perguntas() {
  return pedido.mock.calls.map(([url, o]) => ({
    url: String(url),
    corpo: Object.fromEntries(o?.body as URLSearchParams),
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', pedido);
  vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', 'chave-publica-de-teste');
  vi.stubEnv('TURNSTILE_SECRET_KEY', 'segredo-de-teste');
  vi.stubEnv('VERCEL_ENV', '');
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
  vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
  vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
  vi.stubEnv('LOGIN_PISO_MS', '0');

  // IP e e-mail novos por caso: o limite guarda estado no modulo.
  n += 1;
  ip = `198.51.${Math.floor(n / 250)}.${(n % 250) + 1}`;
  cabecalhos = new Headers({
    host: 'passem-a-respeitar.test',
    'content-type': 'application/json',
    'x-forwarded-for': ip,
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe.each(FORMULARIOS)('$nome', (f) => {
  it('com token que a Cloudflare aceita, o formulario segue', async () => {
    cloudflare({ success: true, action: f.acao });

    const r = await f.envia({ desafio: TOKEN, isca: '' });

    expect(r.recusado).toBe(false);
    expect(f.andou()).toBe(true);
  });

  it('pergunta a Cloudflare com o token que veio, o IP de quem mandou, e uma vez so', async () => {
    cloudflare({ success: true, action: f.acao });

    await f.envia({ desafio: TOKEN, isca: '' });

    expect(perguntas()).toEqual([
      {
        url: 'https://challenges.cloudflare.com/turnstile/v0/siteverify',
        corpo: { secret: 'segredo-de-teste', response: TOKEN, remoteip: ip },
      },
    ]);
  });

  it.each([
    ['sem o campo do token', { isca: '' }],
    ['com o token vazio', { desafio: '', isca: '' }],
    ['com a isca preenchida', { desafio: TOKEN, isca: 'https://spam.invalid' }],
  ])('%s: recusa sem perguntar nada a ninguem', async (_, extra) => {
    cloudflare({ success: true, action: f.acao });

    const r = await f.envia(extra);

    expect(r).toEqual({ recusado: true, mensagem: RECUSA });
    expect(f.andou()).toBe(false);
    expect(pedido).not.toHaveBeenCalled();
  });

  it.each([
    ['recusado', { success: false, 'error-codes': ['invalid-input-response'] }],
    ['ja gasto', { success: false, 'error-codes': ['timeout-or-duplicate'] }],
    ['tirado em outro formulario', { success: true, action: 'outro-formulario' }],
  ])('token %s: recusa, e o formulario nao anda', async (_, resposta) => {
    cloudflare(resposta);

    const r = await f.envia({ desafio: TOKEN, isca: '' });

    expect(r).toEqual({ recusado: true, mensagem: RECUSA });
    expect(f.andou()).toBe(false);
  });

  it('Cloudflare fora do ar: recusa, nao deixa passar', async () => {
    pedido.mockRejectedValue(new Error('ECONNRESET'));

    const r = await f.envia({ desafio: TOKEN, isca: '' });

    expect(r).toEqual({ recusado: true, mensagem: RECUSA });
    expect(f.andou()).toBe(false);
  });

  it('quem ja bateu no limite nao gera chamada a Cloudflare', async () => {
    cloudflare({ success: true, action: f.acao });
    // Esgota o limite deste IP por fora, sem passar pelo formulario.
    for (let i = 0; i < 25; i++) await limita(f.limite(), 1, 60_000);

    const r = await f.envia({ desafio: TOKEN, isca: '' });

    expect(r.recusado).toBe(true);
    expect(r.mensagem).toMatch(/Muit[oa]s (tentativas|pedidos)/);
    expect(pedido).not.toHaveBeenCalled();
    expect(f.andou()).toBe(false);
  });
});

describe('sem chave configurada, fora de producao', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', '');
    vi.stubEnv('TURNSTILE_SECRET_KEY', '');
  });

  it.each(FORMULARIOS)('$nome: segue sem token, e a isca continua recusando', async (f) => {
    expect((await f.envia({})).recusado).toBe(false);
    expect(f.andou()).toBe(true);

    vi.clearAllMocks();
    n += 1;
    expect(await f.envia({ isca: 'x' })).toEqual({ recusado: true, mensagem: RECUSA });
    expect(f.andou()).toBe(false);
    expect(pedido).not.toHaveBeenCalled();
  });
});

describe('sem chave configurada, em producao', () => {
  it.each(FORMULARIOS)('$nome: recusa tudo', async (f) => {
    vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', '');
    vi.stubEnv('TURNSTILE_SECRET_KEY', '');
    vi.stubEnv('VERCEL_ENV', 'production');

    expect(await f.envia({ desafio: TOKEN, isca: '' })).toEqual({
      recusado: true,
      mensagem: RECUSA,
    });
    expect(f.andou()).toBe(false);
  });
});
