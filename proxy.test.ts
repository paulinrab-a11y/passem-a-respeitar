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
  const { proxy: middleware } = await import('./proxy');
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

  describe('o host do Supabase na CSP', () => {
    const diretiva = (csp: string, nome: string) =>
      csp
        .split(';')
        .map((d) => d.trim())
        .find((d) => d.startsWith(`${nome} `)) ?? '';

    it('entra em img-src, para a foto assinada carregar', async () => {
      const csp = (await roda('/')).headers.get('Content-Security-Policy') ?? '';
      expect(diretiva(csp, 'img-src')).toContain('https://projeto-de-teste.supabase.co');
    });

    // A abertura e para IMAGEM e so. Script vindo de la seria execucao de
    // codigo de terceiro na nossa origem; connect seria exfiltracao.
    it.each(['script-src', 'connect-src', 'frame-src', 'default-src'])(
      'nao entra em %s',
      async (nome) => {
        const csp = (await roda('/')).headers.get('Content-Security-Policy') ?? '';
        expect(diretiva(csp, nome)).not.toContain('supabase.co');
      }
    );
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
    const { proxy: middleware } = await import('./proxy');
    await middleware(pede('/conta', { cookie: 'sb-token=de-quem-pediu' }));

    expect(doSupabase.getAll?.()).toEqual([{ name: 'sb-token', value: 'de-quem-pediu' }]);
  });

  it('nao mistura o cookie de um request com o do seguinte', async () => {
    const { proxy: middleware } = await import('./proxy');

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

  // Sem reler a escolha aqui, a primeira renovacao gravaria o token com a
  // validade cheia do Supabase e quem desmarcou "manter conectado"
  // continuaria logado depois de fechar o navegador.
  it('mantem o token como cookie de sessao quando nao pediram para lembrar', async () => {
    getUser.mockImplementation(async () => {
      doSupabase.setAll?.([
        { name: 'sb-token', value: 'renovado', options: { maxAge: 31536000, path: '/' } },
      ]);
      return { data: { user: { id: 'u1' } } };
    });

    const { proxy: middleware } = await import('./proxy');
    const r = await middleware(pede('/conta', { cookie: 'par_lembrar=0' }));

    expect(r.cookies.get('sb-token')?.maxAge).toBeUndefined();
  });

  it('mantem a validade quando pediram para lembrar', async () => {
    getUser.mockImplementation(async () => {
      doSupabase.setAll?.([
        { name: 'sb-token', value: 'renovado', options: { maxAge: 31536000, path: '/' } },
      ]);
      return { data: { user: { id: 'u1' } } };
    });

    const { proxy: middleware } = await import('./proxy');
    const r = await middleware(pede('/conta', { cookie: 'par_lembrar=1' }));

    expect(r.cookies.get('sb-token')?.maxAge).toBe(31536000);
  });

  it('o token renovado sai sempre httpOnly', async () => {
    getUser.mockImplementation(async () => {
      doSupabase.setAll?.([
        { name: 'sb-token', value: 'renovado', options: { httpOnly: false, path: '/' } },
      ]);
      return { data: { user: { id: 'u1' } } };
    });

    const { proxy: middleware } = await import('./proxy');
    const r = await middleware(pede('/conta', { cookie: 'par_lembrar=1' }));

    expect(r.cookies.get('sb-token')?.httpOnly).toBe(true);
  });
});

describe('http', () => {
  it('redireciona para https fora de localhost', async () => {
    const r = await roda('/', { 'x-forwarded-proto': 'http' });

    expect(r.status).toBe(301);
    expect(r.headers.get('location')).toMatch(/^https:/);
  });
});

describe('os hosts do Mercado Pago na CSP (#108)', () => {
  const diretiva = (csp: string, nome: string) =>
    csp
      .split(';')
      .map((d) => d.trim())
      .find((d) => d.startsWith(`${nome} `) || d === nome) ?? '';

  const PAGAMENTO = '/checkout/pagamento/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

  const cspDe = async (caminho: string) =>
    (await roda(caminho)).headers.get('Content-Security-Policy') ?? '';

  // A lista saiu de medicao: montei o Brick e li as violacoes, uma rodada por
  // vez. Cada host aqui apareceu numa delas.
  it.each([
    ['https://api.mercadopago.com', 'connect-src'],
    ['https://api-static.mercadopago.com', 'connect-src'],
    ['https://secure-fields.mercadopago.com', 'connect-src'],
    ['https://http2.mlstatic.com', 'connect-src'],
    ['https://secure-fields.mercadopago.com', 'frame-src'],
  ])('%s entra em %s na tela de pagamento', async (host, nome) => {
    expect(diretiva(await cspDe(PAGAMENTO), nome)).toContain(host);
  });

  // O ponto da Issue: o host novo vale numa rota so. Se alguem trocar a
  // condicao por um booleano global, estes testes caem.
  it.each(['/', '/conta', '/conta/pedidos', '/checkout', '/entrar'])(
    '%s continua sem host do Mercado Pago',
    async (caminho) => {
      const csp = await cspDe(caminho);

      expect(csp).not.toContain('mercadopago.com');
      expect(csp).not.toContain('mlstatic.com');
    }
  );

  it('fora do pagamento, frame-src continua none', async () => {
    expect(diretiva(await cspDe('/'), 'frame-src')).toBe("frame-src 'none'");
  });

  it('a chave da protecao contra bot nao abre a Cloudflare na tela de pagamento', async () => {
    vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', 'chave-publica-de-teste');
    expect(await cspDe(PAGAMENTO)).not.toContain('cloudflare');
  });

  // `strict-dynamic` faz host em script-src ser IGNORADO. Listar o SDK ali
  // seria linha morta, e linha morta numa politica de seguranca confunde quem
  // for revisar depois.
  it('nao lista host em script-src, nem no pagamento', async () => {
    const script = diretiva(await cspDe(PAGAMENTO), 'script-src');

    expect(script).toContain("'strict-dynamic'");
    expect(script).not.toContain('mercadopago');
    expect(script).not.toContain('mlstatic');
  });

  // Nada de curinga nas diretivas que o Brick pediu: `*.mercadopago.com`
  // cobriria subdominio que ninguem revisou.
  //
  // `style-src 'unsafe-inline'` fica de fora da varredura de proposito: ele e
  // anterior a esta Issue, tem motivo escrito no middleware (o Next injeta
  // <style> inline) e nao tem nada a ver com o Brick.
  it.each(['connect-src', 'frame-src'])('%s nao usa curinga', async (nome) => {
    const d = diretiva(await cspDe(PAGAMENTO), nome);

    expect(d).not.toContain('*');
    expect(d).not.toContain("'unsafe");
  });

  it('script-src continua sem unsafe em producao', async () => {
    const script = diretiva(await cspDe(PAGAMENTO), 'script-src');

    expect(script).not.toContain("'unsafe-inline'");
  });

  // Telemetria e fingerprint do Mercado Livre (#109). Ficaram barrados na #108
  // e foram liberados por decisao do dono em 25/09/2026, com a contrapartida
  // de constar na politica de privacidade. Cada host na diretiva em que foi
  // medido, e em nenhuma outra.
  it.each([
    ['https://api.mercadolibre.com', 'connect-src'],
    ['https://www.mercadolibre.com', 'connect-src'],
    ['https://www.mercadolibre.com', 'img-src'],
    ['https://www.mercadolivre.com', 'img-src'],
  ])('%s entra em %s na tela de pagamento (#109)', async (host, nome) => {
    expect(diretiva(await cspDe(PAGAMENTO), nome)).toContain(host);
  });

  // Cada host so na diretiva em que foi medido: mercadolivre.com so serve
  // imagem (o pixel), e api.mercadolibre.com so recebe conexao (telemetria).
  it('o pixel nao ganha connect-src, e a telemetria nao ganha img-src', async () => {
    const csp = await cspDe(PAGAMENTO);

    expect(diretiva(csp, 'connect-src')).not.toContain('mercadolivre.com');
    expect(diretiva(csp, 'img-src')).not.toContain('api.mercadolibre.com');
  });

  // Fingerprint e para quem esta pagando, nao para quem esta na home.
  it.each(['/', '/conta', '/conta/pedidos', '/checkout', '/entrar', '/privacidade'])(
    '%s continua sem os hosts de antifraude',
    async (caminho) => {
      const csp = await cspDe(caminho);

      expect(csp).not.toContain('mercadolibre.com');
      expect(csp).not.toContain('mercadolivre.com');
    }
  );
});

describe('o iframe da protecao contra bot na CSP (#28)', () => {
  const CLOUDFLARE = 'https://challenges.cloudflare.com';
  const COM_FORMULARIO = ['/', '/entrar', '/criar-conta', '/recuperar-senha'];

  const diretiva = (csp: string, nome: string) =>
    csp
      .split(';')
      .map((d) => d.trim())
      .find((d) => d.startsWith(`${nome} `)) ?? '';

  const cspDe = async (caminho: string) =>
    (await roda(caminho)).headers.get('Content-Security-Policy') ?? '';

  describe('com chave', () => {
    beforeEach(() => {
      vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', 'chave-publica-de-teste');
    });

    it.each(COM_FORMULARIO)('%s abre o iframe, e so o iframe', async (caminho) => {
      const csp = await cspDe(caminho);

      expect(diretiva(csp, 'frame-src')).toBe(`frame-src ${CLOUDFLARE}`);
      // Medido no navegador: o widget nao precisou de mais nada. O script
      // herda a confianca de quem o criou, e quem fala com a Cloudflare e o
      // iframe, de dentro dele.
      expect(csp.split(CLOUDFLARE)).toHaveLength(2);
      expect(diretiva(csp, 'connect-src')).toBe("connect-src 'self'");
    });

    // O ponto e o mesmo do Mercado Pago: host novo vale onde e usado. Pagina
    // que nao tem formulario publico nao tem por que abrir iframe de fora.
    it.each([
      '/privacidade',
      '/redefinir-senha',
      '/conta',
      '/conta/seguranca',
      '/checkout',
      '/entrar/outra-coisa',
      '/api/convite',
    ])('%s continua sem a Cloudflare', async (caminho) => {
      logado(true);
      const csp = await cspDe(caminho);

      expect(csp).not.toContain('cloudflare');
      expect(diretiva(csp, 'frame-src')).toBe("frame-src 'none'");
    });

    it('o redirecionamento para o login tambem leva a politica certa', async () => {
      const r = await roda('/conta');

      expect(r.status).toBe(307);
      expect(r.headers.get('Content-Security-Policy')).not.toContain('cloudflare');
    });
  });

  describe('sem chave', () => {
    it.each(COM_FORMULARIO)('%s fica com a politica de antes', async (caminho) => {
      vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', '');
      const csp = await cspDe(caminho);

      expect(csp).not.toContain('cloudflare');
      expect(diretiva(csp, 'frame-src')).toBe("frame-src 'none'");
    });
  });
});

describe('barreira de origem em /api (#17)', () => {
  const ORIGEM = 'https://passem-a-respeitar.test';
  const OUTRA = 'https://site-que-imita.com';

  function pedeApi(metodo: string, cabecalhos: Record<string, string> = {}) {
    return new NextRequest(`${ORIGEM}/api/convite`, { method: metodo, headers: cabecalhos });
  }

  async function rodaApi(metodo: string, cabecalhos?: Record<string, string>) {
    const { proxy: middleware } = await import('./proxy');
    return middleware(pedeApi(metodo, cabecalhos));
  }

  it('POST de outra origem leva 403 antes de chegar na rota', async () => {
    const r = await rodaApi('POST', { origin: OUTRA });

    expect(r.status).toBe(403);
    expect(r.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it.each(['PUT', 'PATCH', 'DELETE'])('%s de outra origem tambem leva 403', async (metodo) => {
    expect((await rodaApi(metodo, { origin: OUTRA })).status).toBe(403);
  });

  it('POST da propria origem passa', async () => {
    const r = await rodaApi('POST', { origin: ORIGEM });

    expect(r.status).not.toBe(403);
  });

  // Mercado Pago e cron nao sao navegador: nao mandam Origin. Barrar sem
  // Origin quebraria o webhook.
  it('POST sem Origin passa (servidor para servidor)', async () => {
    expect((await rodaApi('POST')).status).not.toBe(403);
  });

  // Sem Allow-Origin o navegador nao entrega a resposta a quem pediu de fora.
  // Barrar a leitura seria redundante e quebraria a home, que faz GET aqui.
  it('GET de outra origem passa, mas sem cabecalho de CORS', async () => {
    const r = await rodaApi('GET', { origin: OUTRA });

    expect(r.status).not.toBe(403);
    expect(r.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('preflight responde vazio e sem nenhum cabecalho de CORS', async () => {
    const r = await rodaApi('OPTIONS', {
      origin: OUTRA,
      'access-control-request-method': 'POST',
    });

    expect(r.status).toBe(204);
    expect(r.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(r.headers.get('Access-Control-Allow-Methods')).toBeNull();
  });

  it('nunca responde Allow-Origin curinga', async () => {
    for (const metodo of ['GET', 'POST', 'OPTIONS']) {
      const r = await rodaApi(metodo, { origin: OUTRA });
      expect(r.headers.get('Access-Control-Allow-Origin')).not.toBe('*');
    }
  });

  it('fora de /api a barreira nao existe', async () => {
    const { proxy: middleware } = await import('./proxy');
    const r = await middleware(
      new NextRequest(`${ORIGEM}/entrar`, { method: 'POST', headers: { origin: OUTRA } })
    );

    expect(r.status).not.toBe(403);
  });
});

/**
 * Um host so em producao (#141). O que se prova: o alias vai para o
 * principal com caminho e query intactos, e tudo o que nao e producao, ou
 * nao e navegacao, passa como sempre passou.
 */
describe('host principal em producao (#141)', () => {
  const PRINCIPAL = 'passem-a-respeitar.exemplo';

  async function chega(url: string, metodo = 'GET') {
    const { proxy: middleware } = await import('./proxy');
    return middleware(new NextRequest(url, { method: metodo }));
  }

  beforeEach(() => {
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', PRINCIPAL);
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
  });

  // O laco da #54: a Vercel poe o dominio mais curto na variavel dela, e o
  // mais curto e o sem www, que ela mesma redireciona para o www. Com o
  // NEXT_PUBLIC_SITE_URL apontando para o www, o www passa e o sem-www e que
  // vai para o www.
  describe('com dominio proprio no NEXT_PUBLIC_SITE_URL', () => {
    beforeEach(() => {
      vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://www.cbacoccupation.com.br');
      vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', 'cbacoccupation.com.br');
    });

    it('o www passa: sem laco com o redirecionamento da Vercel', async () => {
      expect((await chega('https://www.cbacoccupation.com.br/')).status).toBe(200);
    });

    it('o sem-www e o vercel.app vao para o www', async () => {
      for (const host of ['cbacoccupation.com.br', 'passem-a-respeitar.vercel.app']) {
        const r = await chega(`https://${host}/entrar?next=%2Fconta`);
        expect(r.status).toBe(308);
        expect(r.headers.get('location')).toBe(
          'https://www.cbacoccupation.com.br/entrar?next=%2Fconta'
        );
      }
    });

    it('endereco que nao e URL cai na variavel da Vercel', async () => {
      vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'nao-e-url');
      const r = await chega('https://www.cbacoccupation.com.br/');
      expect(r.status).toBe(308);
      expect(r.headers.get('location')).toBe('https://cbacoccupation.com.br/');
    });
  });

  it('alias vai para o principal com 308, mantendo caminho e query', async () => {
    const r = await chega('https://alias-do-time.exemplo/entrar?next=%2Fconta%2Fseguranca');

    expect(r.status).toBe(308);
    expect(r.headers.get('location')).toBe(`https://${PRINCIPAL}/entrar?next=%2Fconta%2Fseguranca`);
    expect(getUser).not.toHaveBeenCalled();
  });

  it('o proprio principal passa', async () => {
    expect((await chega(`https://${PRINCIPAL}/`)).status).toBe(200);
  });

  it('maiuscula no host nao vira laco de redirecionamento', async () => {
    vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', 'Passem-A-Respeitar.Exemplo');

    expect((await chega(`https://${PRINCIPAL}/`)).status).toBe(200);
  });

  it('preview nao redireciona', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview');

    expect((await chega('https://alias-do-time.exemplo/')).status).toBe(200);
  });

  it('fora da Vercel nao redireciona', async () => {
    vi.stubEnv('VERCEL_ENV', '');

    expect((await chega('https://alias-do-time.exemplo/')).status).toBe(200);
  });

  it('/api nao redireciona: webhook e cron sao chamados por servidor', async () => {
    const r = await chega('https://alias-do-time.exemplo/api/cron/conciliacao');

    expect(r.status).not.toBe(308);
    expect(r.headers.get('location')).toBeNull();
  });

  it('POST nao redireciona', async () => {
    const r = await chega('https://alias-do-time.exemplo/conta/seguranca', 'POST');

    expect(r.status).not.toBe(308);
  });

  it.each([
    ['vazia', ''],
    ['com protocolo', 'https://passem-a-respeitar.exemplo'],
    ['com caminho', 'passem-a-respeitar.exemplo/conta'],
    ['com porta', 'passem-a-respeitar.exemplo:8080'],
    ['com arroba', 'usuario@site-falso.exemplo'],
    ['sem ponto', 'localhost'],
  ])('variavel %s nao redireciona', async (_nome, valor) => {
    vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', valor);

    expect((await chega('https://alias-do-time.exemplo/')).status).toBe(200);
  });
});
