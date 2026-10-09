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
 * Sem DSN, `enabled: false`: o SDK nao manda nada e nao pesa. O site roda
 * igual em quem nao tem a variavel (dev sem conta, preview sem Sentry).
 */

type Evento = {
  request?: { cookies?: unknown; headers?: unknown; data?: unknown; query_string?: unknown };
  user?: unknown;
  contexts?: Record<string, unknown>;
};

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
  };
}
