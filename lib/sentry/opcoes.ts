/**
 * Opcoes do Sentry, num lugar so (Issue #8).
 *
 * Tres inicializacoes (servidor, edge, navegador) e nenhuma delas pode
 * discordar das outras sobre o que sai daqui. Por isso as opcoes moram num
 * modulo puro, testavel, e os tres arquivos de config so o chamam.
 *
 * O que NAO sai para o Sentry, e em duas camadas:
 *
 *   1. `dataCollection` desligada — na v11 o padrao coleta cookies, cabecalhos,
 *      corpo de request, query string e variaveis de stack. Tudo isso pode
 *      carregar token de sessao, senha em transito ou e-mail. Desliga na
 *      fonte.
 *   2. `beforeSend` limpa de novo — se uma versao futura mudar um padrao, a
 *      segunda camada segura. Cinto e suspensorio, porque o erro custa a
 *      sessao de alguem num painel de terceiro.
 *
 * Desde a #352 a segunda camada vale tambem para transacoes
 * (`beforeSendTransaction`) e breadcrumbs (`beforeBreadcrumb`), e tira a
 * query string de toda URL que encontra. A busca do painel
 * (`/conta/admin/pedidos?busca=...`) leva nome ou e-mail de cliente na URL,
 * e transacao e breadcrumb carregam a URL inteira: span de fetch, navegacao,
 * nome da transacao.
 *
 * Sem DSN, `enabled: false`: o SDK nao manda nada e nao pesa. O site roda
 * igual em quem nao tem a variavel (dev sem conta, preview sem Sentry).
 */

type Evento = {
  request?: {
    url?: unknown;
    cookies?: unknown;
    headers?: unknown;
    data?: unknown;
    query_string?: unknown;
  };
  user?: unknown;
  contexts?: Record<string, unknown>;
};

type Span = { description?: unknown; data?: Record<string, unknown> };

type Transacao = Evento & { transaction?: unknown; spans?: Span[] };

type Breadcrumb = { message?: unknown; data?: Record<string, unknown> };

/**
 * A URL sem `?...` nem `#...`. Vale para URL absoluta, caminho e texto com
 * URL dentro ("GET /conta?busca=x 200"): corta do `?` ou `#` ate o proximo
 * espaco. Outra coisa que nao texto volta como veio.
 */
export function semQuery<T>(valor: T): T {
  if (typeof valor !== 'string') return valor;
  return valor.replace(/[?#][^\s]*/g, '') as T;
}

/** Chaves de `data` (span e breadcrumb) que levam URL ou pedaco dela. */
const CHAVES_DE_URL = ['url', 'http.url', 'http.target', 'from', 'to', 'server.address'];
/** Chaves que SAO a query ou o fragmento: saem inteiras. */
const CHAVES_DE_QUERY = ['http.query', 'http.fragment', 'url.query', 'url.fragment'];

function limpaDados(dados: Record<string, unknown> | undefined) {
  if (!dados || typeof dados !== 'object') return dados;
  const saida: Record<string, unknown> = {};
  for (const [chave, valor] of Object.entries(dados)) {
    if (CHAVES_DE_QUERY.includes(chave)) continue;
    saida[chave] =
      CHAVES_DE_URL.includes(chave) || chave.startsWith('url.') ? semQuery(valor) : valor;
  }
  return saida;
}

/** Cabecalhos que, se sobrarem, levam a sessao junto. */
const CABECALHOS_SENSIVEIS = ['cookie', 'authorization', 'x-signature', 'set-cookie'];

export function limpa<E extends Evento>(evento: E): E {
  if (evento.request) {
    const { cookies: _c, data: _d, query_string: _q, headers, ...resto } = evento.request;
    const cabecalhos =
      headers && typeof headers === 'object'
        ? Object.fromEntries(
            Object.entries(headers as Record<string, unknown>).filter(
              ([nome]) => !CABECALHOS_SENSIVEIS.includes(nome.toLowerCase())
            )
          )
        : undefined;
    evento.request = cabecalhos ? { ...resto, headers: cabecalhos } : resto;
    if ('url' in evento.request) evento.request.url = semQuery(evento.request.url);
  }

  // Quem e a pessoa nao interessa ao rastreio do erro; o id do pedido ou da
  // rota ja diz onde olhar.
  if ('user' in evento) evento.user = undefined;

  return evento;
}

/**
 * Os tres nomes que a Vercel usa. Qualquer outro valor (variavel digitada a
 * mao, ambiente customizado) nao vira rotulo: cai na proxima fonte. Assim
 * 'production' so aparece quando a Vercel diz que e producao.
 */
const AMBIENTES = ['production', 'preview', 'development'] as const;
type Ambiente = (typeof AMBIENTES)[number];

function conhecido(valor: string | undefined): Ambiente | undefined {
  return AMBIENTES.find((nome) => nome === valor);
}

export function ambiente(): Ambiente {
  // Duas fontes, e a ordem importa (#256).
  //
  // O navegador so enxerga NEXT_PUBLIC_*: o Next troca o texto no bundle
  // durante o build, e VERCEL_ENV chega la como undefined. So com ela, todo
  // erro do navegador em producao chegava ao Sentry como 'development'. A
  // Vercel preenche NEXT_PUBLIC_VERCEL_ENV sozinha no build do Next, com o
  // mesmo valor de VERCEL_ENV, e por isso as tres configs (servidor, edge,
  // navegador) concordam no mesmo deploy.
  //
  // VERCEL_ENV fica de reserva para o servidor, caso a exposicao automatica
  // das variaveis de sistema seja desligada no painel. Fora da Vercel, e
  // desenvolvimento local.
  //
  // Escritas por extenso de proposito: `process.env[nome]` nao e substituido
  // no build (ver lib/supabase/env.ts).
  return (
    conhecido(process.env.NEXT_PUBLIC_VERCEL_ENV) ??
    conhecido(process.env.VERCEL_ENV) ??
    'development'
  );
}

/** Transacao: o mesmo que o erro, mais o nome e cada span (#352). */
export function limpaTransacao<T extends Transacao>(evento: T): T {
  limpa(evento);
  evento.transaction = semQuery(evento.transaction);
  if (Array.isArray(evento.spans)) {
    for (const span of evento.spans) {
      span.description = semQuery(span.description);
      span.data = limpaDados(span.data);
    }
  }
  return evento;
}

/** Breadcrumb de navegacao, fetch ou console: URL sem query (#352). */
export function limpaBreadcrumb<B extends Breadcrumb>(crumb: B): B {
  crumb.message = semQuery(crumb.message);
  crumb.data = limpaDados(crumb.data);
  return crumb;
}

export function opcoesComuns(dsn: string | undefined) {
  return {
    dsn,
    // Sem DSN nao ha para onde mandar. `enabled: false` faz o SDK nem tentar.
    enabled: Boolean(dsn),
    environment: ambiente(),
    // Uma em dez requests com trace. Erro e capturado sempre; isto e so o
    // custo do desempenho, e a cota gratuita e pequena.
    tracesSampleRate: 0.1,
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      stackFrameVariables: false,
    },
    beforeSend: limpa,
    beforeSendTransaction: limpaTransacao,
    beforeBreadcrumb: limpaBreadcrumb,
  };
}
