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
  get: vi.fn((_nome: string): { value: string } | undefined => undefined),
  set: vi.fn(),
};

/** O clienteDeAuth repassa user-agent e IP de quem pediu (#38). */
const cabecalhos = new Headers({
  'user-agent': 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/120.0 Mobile Safari/537.36',
  'x-forwarded-for': '203.0.113.7, 70.41.3.18',
});

vi.mock('next/headers', () => ({
  cookies: async () => jar,
  headers: async () => cabecalhos,
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
  jar.get.mockReturnValue(undefined);
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

  // As opcoes abaixo sao as que o @supabase/ssr manda quando renova o token
  // (DEFAULT_COOKIE_OPTIONS). Repassadas cruas, como se fazia, a renovacao
  // numa rota fora do middleware — a barra da home chama /api/conta/resumo a
  // cada visita — gravava o token legivel por JavaScript e por 400 dias.
  const CRUAS_DO_SUPABASE = {
    path: '/',
    sameSite: 'lax',
    httpOnly: false,
    maxAge: 400 * 24 * 60 * 60,
  };

  it('grava o token renovado endurecido, nao com as opcoes cruas', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const { clienteServidor } = await import('./servidor');
    await clienteServidor();

    const opcoes = criaServidor.mock.calls[0][2] as {
      cookies: { setAll: (l: unknown[]) => void };
    };
    opcoes.cookies.setAll([{ name: 'sb-token', value: 'novo', options: CRUAS_DO_SUPABASE }]);

    expect(jar.set).toHaveBeenCalledWith(
      'sb-token',
      'novo',
      expect.objectContaining({ httpOnly: true, sameSite: 'lax', secure: true, path: '/' })
    );
  });

  // Computador emprestado: a pessoa desmarcou "manter conectado" e volta a
  // home uma hora depois. A renovacao nao pode virar a sessao de 400 dias.
  it('sem par_lembrar, o token renovado continua morrendo com o navegador', async () => {
    const { clienteServidor } = await import('./servidor');
    await clienteServidor();

    const opcoes = criaServidor.mock.calls[0][2] as {
      cookies: { setAll: (l: unknown[]) => void };
    };
    opcoes.cookies.setAll([{ name: 'sb-token', value: 'novo', options: CRUAS_DO_SUPABASE }]);

    expect(jar.get).toHaveBeenCalledWith('par_lembrar');
    expect(jar.set).toHaveBeenCalledWith(
      'sb-token',
      'novo',
      expect.objectContaining({ maxAge: undefined, expires: undefined })
    );
  });

  it('com par_lembrar=1, mantem a validade que o Supabase pediu', async () => {
    jar.get.mockReturnValue({ value: '1' });
    const { clienteServidor } = await import('./servidor');
    await clienteServidor();

    const opcoes = criaServidor.mock.calls[0][2] as {
      cookies: { setAll: (l: unknown[]) => void };
    };
    opcoes.cookies.setAll([{ name: 'sb-token', value: 'novo', options: CRUAS_DO_SUPABASE }]);

    expect(jar.set).toHaveBeenCalledWith(
      'sb-token',
      'novo',
      expect.objectContaining({ maxAge: CRUAS_DO_SUPABASE.maxAge, httpOnly: true })
    );
  });

  // O Supabase apaga o pedaco que sobrou de um token maior com maxAge 0. Sem
  // "manter conectado", tirar esse maxAge deixaria um cookie vazio no lugar.
  it('apagar continua apagando, mesmo sem manter conectado', async () => {
    const { clienteServidor } = await import('./servidor');
    await clienteServidor();

    const opcoes = criaServidor.mock.calls[0][2] as {
      cookies: { setAll: (l: unknown[]) => void };
    };
    opcoes.cookies.setAll([
      { name: 'sb-token.1', value: '', options: { ...CRUAS_DO_SUPABASE, maxAge: 0 } },
    ]);

    expect(jar.set).toHaveBeenCalledWith(
      'sb-token.1',
      '',
      expect.objectContaining({ maxAge: 0, httpOnly: true })
    );
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

  it('repassa o user-agent de quem pediu, nao o do servidor', async () => {
    const { clienteDeAuth } = await import('./servidor');
    await clienteDeAuth(true);

    const opcoes = criaServidor.mock.calls[0][2] as { global: { headers: Record<string, string> } };
    expect(opcoes.global.headers['User-Agent']).toMatch(/Pixel 8/);
  });

  // Sem isto, a tela de aparelhos conectados mostraria o IP de saida da
  // Vercel para todo mundo — e um alarme falso numa tela de seguranca.
  it('repassa so o primeiro IP do x-forwarded-for', async () => {
    const { clienteDeAuth } = await import('./servidor');
    await clienteDeAuth(true);

    const opcoes = criaServidor.mock.calls[0][2] as { global: { headers: Record<string, string> } };
    expect(opcoes.global.headers['X-Forwarded-For']).toBe('203.0.113.7');
  });

  it('corta cabecalho gigante', async () => {
    cabecalhos.set('user-agent', 'a'.repeat(5000));
    const { clienteDeAuth } = await import('./servidor');
    await clienteDeAuth(true);

    const opcoes = criaServidor.mock.calls[0][2] as { global: { headers: Record<string, string> } };
    expect(opcoes.global.headers['User-Agent'].length).toBeLessThanOrEqual(400);
    cabecalhos.set(
      'user-agent',
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/120.0 Mobile Safari/537.36'
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

describe('lembrarDaSessao', () => {
  // E o que reautenticar, trocar senha e trocar e-mail passam para
  // clienteDeAuth. Antes cada um decidia por si, e dois passavam `true` fixo:
  // sessao de computador emprestado virava sessao de trinta dias (#244).
  it('le a escolha do cookie proprio', async () => {
    const { lembrarDaSessao } = await import('./servidor');

    jar.get.mockReturnValue({ value: '1' });
    expect(await lembrarDaSessao()).toBe(true);
    expect(jar.get).toHaveBeenCalledWith('par_lembrar');

    jar.get.mockReturnValue({ value: '0' });
    expect(await lembrarDaSessao()).toBe(false);
  });

  // Login anterior ao cookie, ou cookie apagado: o lado seguro e o cookie de
  // sessao, que morre com o navegador.
  it('sem o cookie, nao mantem conectado', async () => {
    const { lembrarDaSessao } = await import('./servidor');
    expect(await lembrarDaSessao()).toBe(false);
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
