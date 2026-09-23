import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// O Supabase e trocado por um duble: o que se testa aqui e a decisao do
// middleware diante de "tem usuario" ou "nao tem", nao a rede.
const getUser = vi.fn(async () => ({ data: { user: null as { id: string } | null } }));
const doSupabase: {
  setAll: ((l: unknown[]) => void) | null;
  getAll: (() => { name: string; value: string }[]) | null;
} = { setAll: null, getAll: null };

vi.mock('@supabase/ssr', () => ({
  createServerClient: (
    _url: string,
    _chave: string,
    opcoes: { cookies: { setAll: never; getAll: never } }
  ) => {
    // Guardados para o teste simular a renovacao do token e conferir de onde
    // os cookies sao lidos.
    doSupabase.setAll = opcoes.cookies.setAll;
    doSupabase.getAll = opcoes.cookies.getAll;
    return { auth: { getUser } };
  },
}));

function pede(caminho: string, cabecalhos: Record<string, string> = {}) {
  return new NextRequest(`https://passem-a-respeitar.test${caminho}`, { headers: cabecalhos });
}

async function roda(caminho: string, cabecalhos?: Record<string, string>) {
  const { middleware } = await import('./middleware');
  return middleware(pede(caminho, cabecalhos));
}

function logado(sim: boolean) {
  getUser.mockResolvedValue({ data: { user: sim ? { id: 'u1' } : null } });
}

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://projeto-de-teste.supabase.co');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_chave_de_teste');
  vi.clearAllMocks();
  doSupabase.setAll = null;
  doSupabase.getAll = null;
  logado(false);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('rota publica', () => {
  it('deixa a home passar sem consultar o Supabase', async () => {
    const r = await roda('/');

    expect(r.status).toBe(200);
    // O custo que esta guarda evita: uma ida de rede na pagina que quase todo
    // mundo ve. Se alguem ampliar o matcher sem pensar, este teste cai.
    expect(getUser).not.toHaveBeenCalled();
  });

  it('continua carimbando a CSP com nonce', async () => {
    const r = await roda('/');
    const csp = r.headers.get('Content-Security-Policy') ?? '';

    expect(csp).toMatch(/script-src [^;]*'nonce-[^']+'/);
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it('da um nonce diferente a cada request', async () => {
    const a = (await roda('/')).headers.get('Content-Security-Policy');
    const b = (await roda('/')).headers.get('Content-Security-Policy');

    expect(a).not.toBe(b);
  });
});

describe('/conta sem sessao', () => {
  it('manda para o login guardando o destino', async () => {
    const r = await roda('/conta/pedidos');

    expect(r.status).toBe(307);
    const destino = new URL(r.headers.get('location') ?? '');
    expect(destino.pathname).toBe('/entrar');
    expect(destino.searchParams.get('next')).toBe('/conta/pedidos');
  });

  it('guarda tambem a query da rota pedida', async () => {
    const r = await roda('/conta/pedidos?pagina=2');
    const destino = new URL(r.headers.get('location') ?? '');

    expect(destino.searchParams.get('next')).toBe('/conta/pedidos?pagina=2');
  });

  it('protege a raiz da conta', async () => {
    const r = await roda('/conta');
    expect(new URL(r.headers.get('location') ?? '').pathname).toBe('/entrar');
  });

  it('nao carrega para o login um next que a vitima nao pediu', async () => {
    // Quem chega em /conta/x nao escolheu nada: o next e montado por nos a
    // partir do caminho, nunca copiado da query de entrada.
    const r = await roda('/conta/x?next=https://site-que-imita.com');
    const destino = new URL(r.headers.get('location') ?? '');

    expect(destino.searchParams.get('next')).toBe('/conta/x?next=https://site-que-imita.com');
    expect(destino.searchParams.getAll('next')).toHaveLength(1);
  });

  it('a resposta de redirecionamento tambem leva a CSP', async () => {
    const r = await roda('/conta');
    expect(r.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
  });
});

describe('/conta com sessao', () => {
  it('deixa passar', async () => {
    logado(true);
    const r = await roda('/conta/pedidos');

    expect(r.status).toBe(200);
    expect(r.headers.get('location')).toBe(null);
  });

  it('confere a sessao de verdade, nao so a presenca do cookie', async () => {
    logado(true);
    await roda('/conta');
    expect(getUser).toHaveBeenCalled();
  });
});

describe('paginas de auth com sessao', () => {
  it.each(['/entrar', '/criar-conta', '/recuperar-senha'])(
    '%s manda quem ja esta logado para a conta',
    async (rota) => {
      logado(true);
      const r = await roda(rota);

      expect(r.status).toBe(307);
      expect(new URL(r.headers.get('location') ?? '').pathname).toBe('/conta');
    }
  );

  it('devolve para a rota pedida quando o next e de conta', async () => {
    logado(true);
    const r = await roda('/entrar?next=/conta/pedidos');
    const destino = new URL(r.headers.get('location') ?? '');

    expect(destino.pathname).toBe('/conta/pedidos');
  });

  it('preserva a query do next', async () => {
    logado(true);
    const r = await roda('/entrar?next=%2Fconta%2Fpedidos%3Fpagina%3D2');
    const destino = new URL(r.headers.get('location') ?? '');

    expect(destino.pathname).toBe('/conta/pedidos');
    expect(destino.searchParams.get('pagina')).toBe('2');
  });

  // O teste de open redirect no que de fato vai para a rede: nao basta
  // destinoSeguro estar certo, o middleware tem que usar a saida dele.
  it.each(['https://site-que-imita.com', '//site-que-imita.com', '/\\site-que-imita.com', '/'])(
    'nunca sai do site com next=%s',
    async (next) => {
      logado(true);
      const r = await roda(`/entrar?next=${encodeURIComponent(next)}`);
      const destino = new URL(r.headers.get('location') ?? '');

      expect(destino.host).toBe('passem-a-respeitar.test');
      expect(destino.pathname).toBe('/conta');
    }
  );

  it('deixa quem nao esta logado ver a pagina de login', async () => {
    const r = await roda('/entrar');
    expect(r.status).toBe(200);
  });
});

describe('leitura de cookie', () => {
  // De onde o middleware le a sessao importa: tem que ser do request que
  // chegou, e nao de algum estado compartilhado entre requests. Em edge
  // runtime a mesma instancia atende varias pessoas, e ler do lugar errado
  // entregaria a sessao de uma para a outra.
  it('le os cookies do request que chegou', async () => {
    const { middleware } = await import('./middleware');
    await middleware(pede('/conta', { cookie: 'sb-token=de-quem-pediu' }));

    expect(doSupabase.getAll?.()).toEqual([{ name: 'sb-token', value: 'de-quem-pediu' }]);
  });

  it('nao mistura o cookie de um request com o do seguinte', async () => {
    const { middleware } = await import('./middleware');

    await middleware(pede('/conta', { cookie: 'sb-token=primeiro' }));
    const primeiro = doSupabase.getAll?.();

    await middleware(pede('/conta', { cookie: 'sb-token=segundo' }));
    const segundo = doSupabase.getAll?.();

    expect(primeiro).toEqual([{ name: 'sb-token', value: 'primeiro' }]);
    expect(segundo).toEqual([{ name: 'sb-token', value: 'segundo' }]);
  });
});

describe('renovacao de token', () => {
  it('leva o cookie novo no redirecionamento', async () => {
    // Sem isso o token renovado ficaria na resposta descartada e a pessoa
    // rodaria com o token velho ate ser deslogada sem motivo aparente.
    getUser.mockImplementation(async () => {
      doSupabase.setAll?.([{ name: 'sb-token', value: 'renovado', options: { path: '/' } }]);
      return { data: { user: null } };
    });

    const r = await roda('/conta');

    expect(r.status).toBe(307);
    expect(r.cookies.get('sb-token')?.value).toBe('renovado');
  });
});

describe('http', () => {
  it('redireciona para https fora de localhost', async () => {
    const r = await roda('/', { 'x-forwarded-proto': 'http' });

    expect(r.status).toBe(301);
    expect(r.headers.get('location')).toMatch(/^https:/);
  });
});
