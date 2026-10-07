import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * O caminho de verdade da renovacao fora do middleware (#254).
 *
 * A barra da home chama esta rota a cada visita, e nem a home nem `/api`
 * passam pelo middleware que renova a sessao. Com o token vencido, quem
 * renova e o `getUser()` daqui, e o @supabase/ssr pede para gravar o cookie
 * novo com as opcoes dele: `httpOnly: false` e 400 dias.
 *
 * Por isso aqui nada do Supabase e trocado por espiao: a biblioteca e a de
 * verdade, e so a rede e falsa. Um teste com `createServerClient` simulado
 * passaria mesmo se a biblioteca mudasse o jeito de gravar.
 */

const REF = 'projeto-de-teste';
const COOKIE_SESSAO = `sb-${REF}-auth-token`;

type Gravado = { name: string; value: string; options: Record<string, unknown> };

const jar = {
  atuais: new Map<string, string>(),
  gravados: [] as Gravado[],
  getAll() {
    return [...this.atuais].map(([name, value]) => ({ name, value }));
  },
  get(nome: string) {
    const value = this.atuais.get(nome);
    return value === undefined ? undefined : { name: nome, value };
  },
  set(name: string, value: string, options: Record<string, unknown>) {
    this.gravados.push({ name, value, options });
  },
};

vi.mock('next/headers', () => ({
  cookies: async () => jar,
  headers: async () => new Headers(),
}));

const agoraS = () => Math.floor(Date.now() / 1000);

const usuario = {
  id: '11111111-1111-4111-8111-111111111111',
  aud: 'authenticated',
  role: 'authenticated',
  email: 'pessoa@exemplo.invalid',
  app_metadata: {},
  user_metadata: {},
  created_at: '2026-08-15T09:00:00Z',
};

/** O formato que o @supabase/ssr grava: prefixo `base64-` e JSON em base64url. */
function cookieDeSessao(sessao: object) {
  return `base64-${Buffer.from(JSON.stringify(sessao)).toString('base64url')}`;
}

function json(corpo: unknown) {
  return new Response(JSON.stringify(corpo), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Responde como o Supabase: renova o token, diz quem e, devolve o perfil. */
const rede = vi.fn(async (entrada: RequestInfo | URL) => {
  const url = new URL(entrada instanceof Request ? entrada.url : String(entrada));

  if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token') {
    return json({
      access_token: 'token-de-acesso-novo',
      refresh_token: 'token-de-renovacao-novo',
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: agoraS() + 3600,
      user: usuario,
    });
  }
  if (url.pathname === '/auth/v1/user') return json(usuario);
  if (url.pathname === '/rest/v1/profiles') {
    return json([
      { nome: 'Santxx Oliveira', criado_em: '2026-08-15T09:00:00Z', foto_caminho: null },
    ]);
  }
  return new Response('{}', { status: 404 });
});

let n = 0;
const pede = () =>
  new NextRequest('https://passem-a-respeitar.test/api/conta/resumo', {
    headers: { 'x-forwarded-for': `198.51.100.${(n++ % 200) + 1}` },
  });

beforeEach(() => {
  // O limite por IP fica na memoria: Redis de verdade nao entra em teste.
  vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
  vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
  vi.stubGlobal('fetch', rede);
  rede.mockClear();

  jar.gravados = [];
  jar.atuais = new Map([
    [
      COOKIE_SESSAO,
      // Venceu ha um minuto: a pessoa voltou a home mais de uma hora depois.
      cookieDeSessao({
        access_token: 'token-de-acesso-vencido',
        refresh_token: 'token-de-renovacao-velho',
        token_type: 'bearer',
        expires_in: 3600,
        expires_at: agoraS() - 60,
        user: usuario,
      }),
    ],
  ]);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

/** O cookie do token que a rota gravou, ja conferido que a renovacao houve. */
async function renovaPelaRota() {
  const { GET } = await import('./route');
  const corpo = await (await GET(pede())).json();

  expect(corpo.logado).toBe(true);
  const renovou = rede.mock.calls.some(([u]) => String(u).includes('grant_type=refresh_token'));
  expect(renovou).toBe(true);

  const sessao = jar.gravados.filter((c) => c.name.startsWith(COOKIE_SESSAO) && c.value);
  expect(sessao.length).toBeGreaterThan(0);
  return sessao;
}

describe('GET /api/conta/resumo com o token vencido', () => {
  it('grava o token renovado httpOnly e sameSite lax', async () => {
    for (const { options } of await renovaPelaRota()) {
      expect(options.httpOnly).toBe(true);
      expect(options.sameSite).toBe('lax');
    }
  });

  it('em producao, so por https', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    for (const { options } of await renovaPelaRota()) {
      expect(options.secure).toBe(true);
    }
  });

  // O caso do computador emprestado: "manter conectado" desmarcado, e a
  // politica de privacidade promete que a sessao some ao fechar o navegador.
  it('sem "manter conectado", o token renovado continua morrendo com o navegador', async () => {
    for (const { options } of await renovaPelaRota()) {
      expect(options.maxAge).toBeUndefined();
      expect(options.expires).toBeUndefined();
    }
  });

  it('com "manter conectado", a validade continua a do Supabase', async () => {
    jar.atuais.set('par_lembrar', '1');
    for (const { options } of await renovaPelaRota()) {
      expect(options.maxAge).toBeGreaterThan(0);
      expect(options.httpOnly).toBe(true);
    }
  });
});
