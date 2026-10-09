import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { limita } from '@/lib/rate-limit';
import { RECUSA } from '@/lib/robo';

/**
 * Os formularios publicos, atras da protecao contra bot (#28).
 *
 * O mesmo contrato, conferido em todos de uma vez — login, cadastro, reenvio
 * do codigo do cadastro (#224), recuperacao de senha, convite e concierge
 * (#191):
 *
 *   - isca preenchida ou envio sem token: recusa, e nada acontece
 *   - token que a Cloudflare recusa: recusa, e nada acontece
 *   - token que a Cloudflare aceita: o formulario segue
 *   - a recusa e a mesma frase nos cinco, e nao conta nada sobre a conta
 *
 * "Nada acontece" e literal: o Supabase nao e chamado, e-mail nao sai, codigo
 * de convite nao e conferido, nada sai para o Gemini.
 */

type ErroDoSupabase = { message: string; code?: string; status?: number } | null;

const auth = {
  signInWithPassword: vi.fn(async (_: unknown) => ({ error: null as ErroDoSupabase })),
  signUp: vi.fn(async (_: unknown) => ({ data: { session: null }, error: null })),
  resend: vi.fn(async (_: unknown) => ({ error: null as ErroDoSupabase })),
  resetPasswordForEmail: vi.fn(async (..._: unknown[]) => ({ error: null })),
};
const codigoConfere = vi.fn(async (_: string) => false);
const pergunta = vi.fn(async (..._: unknown[]) => 'Dia 20 de novembro.');
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
// O Gemini fica de fora: o que se prova e que a rota nem chega nele.
vi.mock('@/lib/concierge/gemini', () => ({
  pergunta: (...a: unknown[]) => pergunta(...a),
}));

const { entrar } = await import('./entrar/acoes');
const { estadoInicial } = await import('./entrar/estado');
const { criarConta, reenviarCodigo } = await import('./criar-conta/acoes');
const { criarContaInicial } = await import('./criar-conta/estado');
const { reenvioInicial } = await import('./_ui/estado-do-codigo');
const { recuperarSenha } = await import('./recuperar-senha/acoes');
const { recuperarInicial } = await import('./recuperar-senha/estado');
const { POST: convite } = await import('./api/convite/route');
const { POST: concierge } = await import('./api/concierge/route');

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
    nome: 'reenvio do codigo',
    acao: 'reenviar-codigo',
    limite: () => `reenvio:ip:${ip}`,
    andou: () => auth.resend.mock.calls.length > 0,
    async envia(extra: Extra): Promise<Resposta> {
      const r = await reenviarCodigo(reenvioInicial, formulario({ email: email() }, extra));
      return { recusado: r.erro !== null, mensagem: r.erro };
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
  {
    nome: 'concierge',
    acao: 'concierge',
    limite: () => `concierge:${ip}`,
    andou: () => pergunta.mock.calls.length > 0,
    async envia({ desafio, isca }: Extra): Promise<Resposta> {
      const r = await concierge(
        new Request('https://passem-a-respeitar.test/api/concierge', {
          method: 'POST',
          headers: cabecalhos,
          body: JSON.stringify({ mensagem: 'quando sai?', desafio, website: isca }),
        })
      );
      const corpo = await r.json();
      return { recusado: r.status !== 200, mensagem: corpo.erro ?? null };
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
  auth.signInWithPassword.mockResolvedValue({ error: null });
  auth.resend.mockResolvedValue({ error: null });
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
    expect(r.mensagem).toMatch(/Muit[oa]s (tentativas|pedidos|perguntas)/);
    expect(pedido).not.toHaveBeenCalled();
    expect(f.andou()).toBe(false);
  });
});

/**
 * A cota de codigo por e-mail (#260) e gasta so por quem passou pelo desafio.
 *
 * Antes do desafio, qualquer texto passa por token. Se a cota do e-mail
 * andasse ali, um script trocando de IP esgotaria a de qualquer pessoa com
 * tres envios por hora, sem mandar e-mail nenhum — e, com ela, o codigo que
 * o login manda a quem acertou a senha de uma conta pendente.
 */
describe('cota de codigo por e-mail (#260)', () => {
  function deOutroIp(i: number) {
    ip = `192.0.2.${(n % 50) * 5 + i + 1}`;
    cabecalhos = new Headers({ host: 'passem-a-respeitar.test', 'x-forwarded-for': ip });
  }

  async function scriptComTokenFalso(alvo: string) {
    cloudflare({ success: false, 'error-codes': ['invalid-input-response'] });
    for (let i = 0; i < 4; i++) {
      deOutroIp(i);
      const r = await reenviarCodigo(
        reenvioInicial,
        formulario({ email: alvo }, { desafio: 'x', isca: '' })
      );
      expect(r.erro).toBe(RECUSA);
    }
    expect(auth.resend).not.toHaveBeenCalled();
  }

  it('token recusado nao gasta a cota: o reenvio de verdade ainda sai', async () => {
    const alvo = `pendente${n}@exemplo.invalid`;
    await scriptComTokenFalso(alvo);

    cloudflare({ success: true, action: 'reenviar-codigo' });
    deOutroIp(4);
    const r = await reenviarCodigo(
      reenvioInicial,
      formulario({ email: alvo }, { desafio: TOKEN, isca: '' })
    );

    expect(r.erro).toBeNull();
    expect(auth.resend).toHaveBeenCalledTimes(1);
  });

  it('nem a do codigo que o login manda a quem acertou a senha', async () => {
    const alvo = `pendente${n}@exemplo.invalid`;
    await scriptComTokenFalso(alvo);

    auth.signInWithPassword.mockResolvedValue({
      error: { message: 'Email not confirmed', code: 'email_not_confirmed', status: 400 },
    });
    cloudflare({ success: true, action: 'entrar' });
    deOutroIp(4);
    const r = await entrar(
      estadoInicial,
      formulario({ email: alvo, senha: 'a senha certa' }, { desafio: TOKEN, isca: '' })
    );

    expect(r.confirmar).toEqual({ email: alvo, lembrar: false, enviado: true });
    expect(auth.resend).toHaveBeenCalledTimes(1);
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
