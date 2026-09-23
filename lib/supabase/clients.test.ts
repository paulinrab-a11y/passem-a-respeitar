import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const URL_FALSA = 'https://projeto-de-teste.supabase.co';
const PUBLISHABLE_FALSA = 'sb_publishable_chave_de_teste';
const SECRETA_FALSA = 'sb_secret_chave_de_teste';

// Os construtores sao trocados por espioes: o que importa aqui e COM QUE CHAVE
// cada client e montado, nao se o Supabase responde. Teste que precisa de rede
// para conferir isso nao roda no CI.
//
// O rest de unknown na assinatura e o que permite ler `mock.calls[0][2]`, o
// objeto de opcoes, sem o TypeScript reclamar de tupla vazia.
const criaNavegador = vi.fn((..._args: unknown[]): unknown => ({ tipo: 'navegador' }));
const criaServidor = vi.fn((..._args: unknown[]): unknown => ({ tipo: 'servidor' }));
const criaDireto = vi.fn((..._args: unknown[]): unknown => ({ tipo: 'admin' }));

vi.mock('@supabase/ssr', () => ({
  createBrowserClient: (...args: unknown[]) => criaNavegador(...args),
  createServerClient: (...args: unknown[]) => criaServidor(...args),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: (...args: unknown[]) => criaDireto(...args),
}));

const jar = {
  getAll: vi.fn(() => [{ name: 'sb-token', value: 'abc' }]),
  set: vi.fn(),
};

vi.mock('next/headers', () => ({
  cookies: async () => jar,
}));

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', URL_FALSA);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', PUBLISHABLE_FALSA);

  // `clearAllMocks` zera as chamadas, mas NAO as implementacoes: sem as linhas
  // abaixo, o `mockReturnValue` de um teste e o `jar.set` que lanca vazariam
  // para os seguintes, e a suite passaria a depender da ordem.
  vi.clearAllMocks();
  criaNavegador.mockReturnValue({ tipo: 'navegador' });
  criaServidor.mockReturnValue({ tipo: 'servidor' });
  criaDireto.mockReturnValue({ tipo: 'admin' });
  jar.set.mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('clienteNavegador', () => {
  it('monta com a chave publishable', async () => {
    const { clienteNavegador } = await import('./navegador');
    clienteNavegador();

    expect(criaNavegador).toHaveBeenCalledWith(URL_FALSA, PUBLISHABLE_FALSA);
  });

  // O que este teste guarda: se alguem um dia trocar a chave deste arquivo
  // pela secreta "para funcionar no SSR", o banco inteiro abre para o
  // navegador. Aqui a troca cai na hora.
  it('nunca recebe a chave secreta', async () => {
    vi.stubEnv('SUPABASE_SECRET_KEY', SECRETA_FALSA);
    const { clienteNavegador } = await import('./navegador');
    clienteNavegador();

    expect(criaNavegador).not.toHaveBeenCalledWith(expect.anything(), SECRETA_FALSA);
  });
});

describe('clienteServidor', () => {
  it('monta com a chave publishable, nao com a secreta', async () => {
    vi.stubEnv('SUPABASE_SECRET_KEY', SECRETA_FALSA);
    const { clienteServidor } = await import('./servidor');
    await clienteServidor();

    const [url, chave] = criaServidor.mock.calls[0] as [string, string];
    expect(url).toBe(URL_FALSA);
    expect(chave).toBe(PUBLISHABLE_FALSA);
  });

  it('entrega os cookies do request', async () => {
    const { clienteServidor } = await import('./servidor');
    await clienteServidor();

    const opcoes = criaServidor.mock.calls[0][2] as {
      cookies: { getAll: () => unknown; setAll: (l: unknown[]) => void };
    };
    expect(opcoes.cookies.getAll()).toEqual([{ name: 'sb-token', value: 'abc' }]);
  });

  it('escreve cookie quando da', async () => {
    const { clienteServidor } = await import('./servidor');
    await clienteServidor();

    const opcoes = criaServidor.mock.calls[0][2] as {
      cookies: { setAll: (l: unknown[]) => void };
    };
    opcoes.cookies.setAll([{ name: 'sb-token', value: 'novo', options: { path: '/' } }]);
    expect(jar.set).toHaveBeenCalledWith('sb-token', 'novo', { path: '/' });
  });

  // Server Component nao pode escrever cookie: o Next ja mandou os headers.
  // Sem engolir esse erro, TODA pagina que so le dado do usuario quebraria no
  // momento em que o token fosse renovado.
  it('engole o erro de escrever cookie em Server Component', async () => {
    jar.set.mockImplementation(() => {
      throw new Error('Cookies can only be modified in a Server Action');
    });

    const { clienteServidor } = await import('./servidor');
    await clienteServidor();

    const opcoes = criaServidor.mock.calls[0][2] as {
      cookies: { setAll: (l: unknown[]) => void };
    };
    expect(() => opcoes.cookies.setAll([{ name: 'x', value: 'y', options: {} }])).not.toThrow();
  });
});

describe('clienteDeAuth', () => {
  it('tambem usa a chave publishable, nao a secreta', async () => {
    vi.stubEnv('SUPABASE_SECRET_KEY', SECRETA_FALSA);
    const { clienteDeAuth } = await import('./servidor');
    await clienteDeAuth(true);

    const [url, chave] = criaServidor.mock.calls[0] as [string, string];
    expect(url).toBe(URL_FALSA);
    expect(chave).toBe(PUBLISHABLE_FALSA);
  });

  it('grava o cookie endurecido', async () => {
    const { clienteDeAuth } = await import('./servidor');
    await clienteDeAuth(true);

    const opcoes = criaServidor.mock.calls[0][2] as {
      cookies: { setAll: (l: unknown[]) => void };
    };
    opcoes.cookies.setAll([
      { name: 'sb-token', value: 'abc', options: { httpOnly: false, sameSite: 'none' } },
    ]);

    expect(jar.set).toHaveBeenCalledWith(
      'sb-token',
      'abc',
      expect.objectContaining({ httpOnly: true, sameSite: 'lax', path: '/' })
    );
  });

  it('sem "manter conectado" o token vira cookie de sessao', async () => {
    const { clienteDeAuth } = await import('./servidor');
    await clienteDeAuth(false);

    const opcoes = criaServidor.mock.calls[0][2] as {
      cookies: { setAll: (l: unknown[]) => void };
    };
    opcoes.cookies.setAll([{ name: 'sb-token', value: 'abc', options: { maxAge: 31536000 } }]);

    expect(jar.set).toHaveBeenCalledWith(
      'sb-token',
      'abc',
      expect.objectContaining({ maxAge: undefined })
    );
  });

  // Ao contrario de clienteServidor, este NAO engole o erro de escrever
  // cookie. Numa Server Action a escrita funciona; falhar calado deixaria a
  // pessoa sem sessao depois de um login que disse ter dado certo.
  it('deixa o erro de escrita estourar', async () => {
    jar.set.mockImplementation(() => {
      throw new Error('falhou');
    });

    const { clienteDeAuth } = await import('./servidor');
    await clienteDeAuth(true);

    const opcoes = criaServidor.mock.calls[0][2] as {
      cookies: { setAll: (l: unknown[]) => void };
    };
    expect(() => opcoes.cookies.setAll([{ name: 'x', value: 'y', options: {} }])).toThrow();
  });
});

describe('usuarioDaSessao', () => {
  it('usa getUser, que confere a assinatura, e nao getSession', async () => {
    const getUser = vi.fn(async () => ({ data: { user: { id: 'u1' } }, error: null }));
    const getSession = vi.fn();
    criaServidor.mockReturnValue({ auth: { getUser, getSession } });

    const { usuarioDaSessao } = await import('./servidor');
    const u = await usuarioDaSessao();

    expect(u).toEqual({ id: 'u1' });
    expect(getUser).toHaveBeenCalled();
    // getSession le o cookie e acredita nele. Cookie chega do navegador, e o
    // que chega do navegador e afirmacao, nao fato.
    expect(getSession).not.toHaveBeenCalled();
  });

  it('devolve null quando o token nao confere', async () => {
    criaServidor.mockReturnValue({
      auth: {
        getUser: vi.fn(async () => ({ data: { user: null }, error: { message: 'bad jwt' } })),
      },
    });

    const { usuarioDaSessao } = await import('./servidor');
    expect(await usuarioDaSessao()).toBe(null);
  });
});

describe('clienteAdmin', () => {
  it('monta com a chave secreta', async () => {
    vi.stubEnv('SUPABASE_SECRET_KEY', SECRETA_FALSA);
    const { clienteAdmin } = await import('./admin');
    clienteAdmin();

    const [url, chave] = criaDireto.mock.calls[0] as [string, string];
    expect(url).toBe(URL_FALSA);
    expect(chave).toBe(SECRETA_FALSA);
  });

  it('nao tenta manter sessao', async () => {
    vi.stubEnv('SUPABASE_SECRET_KEY', SECRETA_FALSA);
    const { clienteAdmin } = await import('./admin');
    clienteAdmin();

    const opcoes = criaDireto.mock.calls[0][2] as { auth: Record<string, boolean> };
    expect(opcoes.auth.persistSession).toBe(false);
    expect(opcoes.auth.autoRefreshToken).toBe(false);
  });

  it('explode sem a chave, dizendo que ela e de servidor', async () => {
    vi.stubEnv('SUPABASE_SECRET_KEY', '');
    const { clienteAdmin } = await import('./admin');

    expect(() => clienteAdmin()).toThrow(/NEXT_PUBLIC_/);
    expect(criaDireto).not.toHaveBeenCalled();
  });
});
