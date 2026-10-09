import 'server-only';

/**
 * Cliente da Orders API do Mercado Pago (Issue #110).
 *
 * `POST /v1/orders`, e nao `/v1/payments`: a documentacao atual marca a
 * Payments API como legado e aponta a Orders como o Checkout Transparente de
 * hoje. As duas falam vocabularios diferentes de status, e e por isso que a
 * tabela `pagamentos` da #102 guarda o status CRU do provedor ao lado do nosso
 * estado interno — traduzir num lugar so, e nunca copiar o enum de ninguem.
 *
 * O Access Token e lido AQUI e so aqui. Este arquivo e `server-only`, entao um
 * import acidental em client component quebra o build em vez de vazar a chave.
 */

import * as Sentry from '@sentry/nextjs';
import { enviaDepois } from '@/lib/sentry/depois';
import { montaEstado, type ResumoDoProvedor } from './estado-do-pagamento';

const BASE = 'https://api.mercadopago.com';

/** Os unicos hosts que o desvio da suite aceita: esta maquina. */
const MAQUINA_LOCAL = new Set(['127.0.0.1', 'localhost']);

/**
 * Para onde vao as chamadas (#274). Lido a cada chamada, nao no topo do
 * modulo: o teste troca o ambiente.
 *
 * `MERCADOPAGO_API_URL` existe para a suite de ponta a ponta apontar para um
 * Mercado Pago falso nesta maquina, como o `MELHOR_ENVIO_URL` do frete. Em
 * producao ela e ignorada.
 *
 * Aqui o desvio e mais estreito que o do frete: so vale `http` para esta
 * maquina. O Access Token vai no cabecalho de TODA chamada, e e ele que cobra
 * e estorna. Uma variavel esquecida num preview, apontando para outro host,
 * entregaria a chave a quem estivesse do outro lado. Endereco que nao e desta
 * maquina e ignorado, e a chamada vai ao Mercado Pago de verdade.
 */
function base(): string {
  if (process.env.VERCEL_ENV === 'production') return BASE;

  const desvio = process.env.MERCADOPAGO_API_URL;
  if (!desvio) return BASE;

  try {
    const url = new URL(desvio);
    if (url.protocol === 'http:' && MAQUINA_LOCAL.has(url.hostname)) return url.origin;
  } catch {
    // Texto que nao e URL cai no mesmo lugar que host de fora.
  }

  return BASE;
}

/** Passado o prazo, a tentativa vira erro em vez de pendurar o checkout. */
const PRAZO_MS = 20_000;

function token(): string {
  const t = process.env.MERCADOPAGO_ACCESS_TOKEN;

  if (!t) {
    // Falha fechada, com o nome da variavel. A alternativa comum — seguir com
    // undefined — vira "401 Unauthorized" tres camadas adiante, e ninguem
    // liga o erro a uma variavel que nao foi cadastrada.
    throw new Error(
      'MERCADOPAGO_ACCESS_TOKEN nao definida. E variavel de servidor: nunca ' +
        'com prefixo NEXT_PUBLIC_, nunca em client component.'
    );
  }

  return t;
}

/**
 * Centavos para o texto que a Orders API espera: `"120.00"`.
 *
 * O banco guarda inteiro e a API quer decimal em string. A conversao acontece
 * aqui, uma vez — espalhada, e so questao de tempo ate alguem mandar `120.5`
 * ou um float com sobra binaria.
 */
export function valorParaApi(centavos: number): string {
  return (centavos / 100).toFixed(2);
}

export type MetodoDePagamento =
  | { tipo: 'pix' }
  | { tipo: 'cartao'; bandeira: string; token: string; parcelas: number };

export type DadosDaCobranca = {
  pedidoId: string;
  totalCentavos: number;
  email: string;
  documento?: { tipo: string; numero: string } | null;
  metodo: MetodoDePagamento;
  idempotencia: string;
};

/**
 * O que volta para quem chamou. Enxuto: nada de objeto cru do provedor.
 *
 * Os motivos de falha nao custam igual (#23): `recusado` e o cartao, e cabe
 * outro; `invalido` e pedido que o provedor nao aceitou; `indisponivel` e nao
 * saber se a ordem nasceu la; `configuracao` e credencial recusada — problema
 * nosso, nao da pessoa, e ela nao pode ler "nao aprovado" por isso.
 */
export type RespostaDaCobranca =
  | {
      ok: true;
      provedorId: string;
      resumo: ResumoDoProvedor;
      /** So em Pix. Vem do provedor, nunca gerado aqui. */
      pix?: { copiaECola: string; qrBase64: string | null; expiraEm: string | null };
    }
  | {
      ok: false;
      motivo: 'recusado' | 'invalido' | 'indisponivel' | 'configuracao';
      /** O que o provedor disse da tentativa, quando disse: vai para a linha. */
      resumo?: ResumoDoProvedor;
    };

/**
 * Uma ordem como a consulta e a busca a devolvem. Enxuta, como o resto: id,
 * de que pedido e, quando nasceu, em que estado esta.
 */
export type OrdemEncontrada = {
  provedorId: string;
  /** O `external_reference` que mandamos ao criar — `orders.id`. */
  referencia: string | null;
  /** Quando nasceu la, em ms. `null` se o provedor nao disse. */
  criadaEmMs: number | null;
  resumo: ResumoDoProvedor;
};

/**
 * Resultado de perguntar ao provedor por uma ordem. "Nao achei" e "nao
 * consegui perguntar" sao respostas diferentes, e a diferenca e dinheiro: a
 * primeira autoriza seguir, a segunda manda esperar.
 */
export type Localizacao = { ok: true; ordem: OrdemEncontrada | null } | { ok: false };

/**
 * Resultado de pedir o cancelamento. `invalido` e o provedor dizendo "nao
 * posso": a ordem ja e final la (paga, expirada), e quem chama vai perguntar
 * qual e o estado de verdade. `inexistente` e "nao conheco essa ordem" — id
 * de outra conta, do sandbox — e quem chama confere antes de dar por morta.
 * `indisponivel` e nao ter conseguido perguntar.
 */
export type RespostaDoCancelamento =
  | { ok: true; status: string | null; statusDetail: string | null }
  | { ok: false; motivo: 'invalido' | 'inexistente' | 'indisponivel' };

/**
 * Resultado de pedir o estorno. Le-se como o do cancelamento: `invalido` e o
 * provedor dizendo "nao posso" — ordem que nao esta paga, ja estornada pelo
 * painel dele, prazo de estorno vencido — e quem chama pergunta o estado
 * real; `inexistente` e "nao conheco essa ordem"; `indisponivel` e nao ter
 * conseguido perguntar.
 */
export type RespostaDoEstorno = RespostaDoCancelamento;

type Pagamento = {
  id?: string;
  status?: string;
  status_detail?: string;
  payment_method?: {
    qr_code?: string;
    qr_code_base64?: string;
    ticket_url?: string;
  };
  expiration_time?: string;
};

type OrdemDoProvedor = {
  id?: string;
  status?: string;
  status_detail?: string;
  external_reference?: string;
  created_date?: string;
  transactions?: { payments?: Pagamento[] };
};

function corpo(dados: DadosDaCobranca) {
  const valor = valorParaApi(dados.totalCentavos);

  const meio =
    dados.metodo.tipo === 'pix'
      ? { id: 'pix', type: 'bank_transfer' }
      : {
          id: dados.metodo.bandeira,
          type: 'credit_card',
          token: dados.metodo.token,
          installments: dados.metodo.parcelas,
        };

  return {
    type: 'online',
    total_amount: valor,
    // A chave de conciliacao: e por ela que o webhook acha o pedido depois.
    external_reference: dados.pedidoId,
    processing_mode: 'automatic',
    transactions: { payments: [{ amount: valor, payment_method: meio }] },
    payer: {
      email: dados.email,
      ...(dados.documento
        ? { identification: { type: dados.documento.tipo, number: dados.documento.numero } }
        : {}),
    },
  };
}

/** O estado da ordem e o do primeiro pagamento dela; sem pagamento, o da ordem. */
function resumoDaOrdem(ordem: OrdemDoProvedor): ResumoDoProvedor {
  const pagamento = ordem.transactions?.payments?.[0];

  return montaEstado(
    pagamento?.status ?? ordem.status,
    pagamento?.status_detail ?? ordem.status_detail
  );
}

function encontrada(ordem: OrdemDoProvedor, idPedido?: string): OrdemEncontrada | null {
  const provedorId = String(ordem.id ?? idPedido ?? '');
  if (!provedorId) return null;

  const criadaEm = ordem.created_date ? Date.parse(ordem.created_date) : Number.NaN;

  return {
    provedorId,
    referencia: ordem.external_reference ?? null,
    criadaEmMs: Number.isNaN(criadaEm) ? null : criadaEm,
    resumo: resumoDaOrdem(ordem),
  };
}

/**
 * Aviso ao dono de que a Orders API respondeu erro. Vai o HTTP e, quando ha,
 * o code do primeiro erro — nunca o corpo, que ecoa o que mandamos (e-mail,
 * documento). O envio sai depois da resposta (#281): quem esta no checkout
 * ve a recusa sem esperar o aviso ao dono.
 */
function avisaFalha(status: number, nivel: 'error' | 'warning', code: string | null) {
  Sentry.captureMessage('orders-api: falha', {
    level: nivel,
    tags: { status, ...(code ? { code } : {}) },
  });
  enviaDepois();
}

/**
 * O `code` do primeiro erro, e so ele. O corpo de erro da Orders API vem como
 * `{ errors: [{ code, message, details }] }`; `message` e `details` repetem o
 * que mandamos e ficam aqui. Forma que nao reconhecemos e "sem code".
 */
function codigoDoErro(corpo: unknown): string | null {
  const erros = (corpo as { errors?: unknown } | null)?.errors;
  if (!Array.isArray(erros)) return null;

  const code = (erros[0] as { code?: unknown } | undefined)?.code;
  return typeof code === 'string' && code ? code.slice(0, 64) : null;
}

/**
 * O que um HTTP de erro na criacao quer dizer (#23).
 *
 * Tratar todo 4xx como "cartao recusado" escondia o pior caso: token
 * revogado virava "nao aprovado" para TODO cliente, e o dono so descobria
 * quando alguem reclamasse.
 *
 *   401/403  credencial recusada: e configuracao nossa. Aviso ao dono.
 *   5xx      problema la; vale repetir. Aviso ao dono.
 *   402      o cartao. O status_detail do pagamento e o que a linha guarda.
 *   400/422  pedido que o provedor nao aceitou: o code vai para a linha, e o
 *            dono e avisado em tom mais baixo — um CPF que a conta passou a
 *            exigir recusa todo Pix, e isso nao pode ficar invisivel.
 */
function recusaDaCriacao(status: number, corpo: unknown): RespostaDaCobranca {
  if (status === 401 || status === 403) {
    avisaFalha(status, 'error', null);
    return { ok: false, motivo: 'configuracao' };
  }

  if (status >= 500) {
    avisaFalha(status, 'error', null);
    return { ok: false, motivo: 'indisponivel' };
  }

  const pagamento = (corpo as OrdemDoProvedor | null)?.transactions?.payments?.[0];
  const code = codigoDoErro(corpo);

  // A tentativa morreu: o que sobrevive e o status cru do pagamento, se o
  // provedor mandou um, ou o code do erro no lugar do detalhe.
  const resumo: ResumoDoProvedor = {
    estado: 'recusado',
    status: pagamento?.status ?? null,
    statusDetail: pagamento?.status_detail ?? code,
  };

  if (status === 402) return { ok: false, motivo: 'recusado', resumo };

  avisaFalha(status, 'warning', code);
  return { ok: false, motivo: 'invalido', resumo };
}

/**
 * Cria a ordem no Mercado Pago.
 *
 * `X-Idempotency-Key` e obrigatorio na Orders API, e a chave vem da linha de
 * `pagamentos` — estavel POR TENTATIVA. Reenviar a mesma tentativa (timeout,
 * clique duplo) reusa a chave e o provedor devolve a MESMA cobranca em vez de
 * criar outra. Gerar uuid novo a cada retry derrotaria a idempotencia
 * justamente no retry, que e quando ela importa.
 */
export async function criaOrdem(dados: DadosDaCobranca): Promise<RespostaDaCobranca> {
  // FORA do try, de proposito. Dentro, o `catch` de rede engoliria a falta da
  // variavel e ela viraria "provedor indisponivel" — justamente o diagnostico
  // ruim que a mensagem de `token()` existe para evitar. Um teste guarda isto.
  const autorizacao = `Bearer ${token()}`;

  let resposta: Response;

  try {
    resposta = await fetch(`${base()}/v1/orders`, {
      method: 'POST',
      headers: {
        Authorization: autorizacao,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': dados.idempotencia,
      },
      body: JSON.stringify(corpo(dados)),
      signal: AbortSignal.timeout(PRAZO_MS),
      cache: 'no-store',
    });
  } catch {
    // Rede caiu ou estourou o prazo. A linha em `pagamentos` ja existe, entao
    // a tentativa nao se perde — e reenviar com a mesma chave nao duplica.
    return { ok: false, motivo: 'indisponivel' };
  }

  // Corpo que nao e JSON vira vazio, nos dois caminhos. Nunca logar `bruto`:
  // ele carrega dado do pagador.
  const bruto: unknown = await resposta.json().catch(() => ({}));

  if (!resposta.ok) return recusaDaCriacao(resposta.status, bruto);

  const ordem = (bruto ?? {}) as OrdemDoProvedor;
  const pagamento = ordem.transactions?.payments?.[0];
  const meio = pagamento?.payment_method;

  return {
    ok: true,
    provedorId: String(ordem.id ?? pagamento?.id ?? ''),
    resumo: resumoDaOrdem(ordem),
    ...(meio?.qr_code
      ? {
          pix: {
            copiaECola: meio.qr_code,
            qrBase64: meio.qr_code_base64 ?? null,
            expiraEm: pagamento?.expiration_time ?? null,
          },
        }
      : {}),
  };
}

/**
 * Le a ordem inteira: id, de que pedido e, quando nasceu, em que estado esta.
 *
 * E o que o webhook usa quando o recurso notificado nao bate com linha
 * nenhuma nossa: o `external_reference` diz de que pedido e, e a data diz se
 * pode ser de uma tentativa cuja resposta se perdeu (#5, #14).
 *
 * 404 e "isso nao e ordem nossa" — resposta, nao falha. Rede, prazo e 5xx sao
 * "nao sei", e quem chama trata diferente.
 */
export async function localizaOrdem(provedorId: string): Promise<Localizacao> {
  try {
    const r = await fetch(`${base()}/v1/orders/${encodeURIComponent(provedorId)}`, {
      headers: { Authorization: `Bearer ${token()}` },
      signal: AbortSignal.timeout(PRAZO_MS),
      cache: 'no-store',
    });

    if (r.status === 404) return { ok: true, ordem: null };
    if (!r.ok) return { ok: false };

    const ordem = (await r.json()) as OrdemDoProvedor;

    return { ok: true, ordem: encontrada(ordem, provedorId) };
  } catch {
    return { ok: false };
  }
}

/**
 * Consulta a ordem no provedor (Issue #45).
 *
 * E a diferenca entre "o webhook disse que foi pago" e "o Mercado Pago
 * confirmou que foi pago". O corpo que chega por HTTP e afirmacao — ate
 * assinado, ele so prova que a notificacao e autentica, nao que o estado ali
 * dentro ainda vale. Quem decide dinheiro e esta chamada.
 *
 * Nao conseguir confirmar nao e o mesmo que confirmar: `null` faz o webhook
 * devolver erro, e o provedor reenvia depois.
 */
export async function consultaOrdem(provedorId: string): Promise<ResumoDoProvedor | null> {
  const localizacao = await localizaOrdem(provedorId);

  return localizacao.ok && localizacao.ordem ? localizacao.ordem.resumo : null;
}

/**
 * Cancela a ordem no provedor (#6, #21).
 *
 * E o que mantem UMA cobranca viva por pedido: trocar o Pix por cartao, ou o
 * dono cancelar um pedido, nao pode deixar um QR pagavel para tras — o
 * dinheiro entraria sem ninguem saber.
 *
 * A chave de idempotencia e de quem chama, e NAO pode ser a da criacao: o
 * provedor guarda a resposta por chave, e reusar a da criacao devolveria a
 * ordem criada com cara de cancelada.
 *
 * 2xx e "cancelada": o corpo so traz o status cru para a coluna. 4xx e o
 * provedor dizendo que nao pode — a ordem ja e final la — e isso e resposta,
 * nao falha: quem chama pergunta o estado real. 404 e separado: a ordem nao
 * existe para esta credencial (id do sandbox com o token de producao), e
 * tratar como "nao pode" deixaria a tentativa presa, porque a consulta
 * tambem nao a acha. Rede, prazo e 5xx sao "nao sei".
 */
export async function cancelaOrdem(
  provedorId: string,
  idempotencia: string
): Promise<RespostaDoCancelamento> {
  return operaOrdem(provedorId, 'cancel', idempotencia);
}

/**
 * Estorna a ordem inteira no provedor (#22).
 *
 * E o que faz o botao "Reembolsar" devolver dinheiro de verdade: antes ele so
 * trocava o status, e o cliente lia "Reembolsado" com o valor ainda na conta
 * do dono.
 *
 * Sem corpo, de proposito: na Orders API o estorno total e um POST vazio em
 * `/refund`; corpo com valor e estorno parcial, e parcial nao existe aqui. A
 * chave de idempotencia e de quem chama, estavel por tentativa e distinta da
 * criacao e do cancelamento, pelo mesmo motivo de `cancelaOrdem`.
 *
 * A leitura da resposta e a do cancelamento: 2xx e "estornada", com o status
 * cru para a coluna; 4xx e "nao posso" (ja estornada pelo painel, prazo
 * vencido), e quem chama pergunta o estado real; 404 e ordem que esta
 * credencial nao tem; rede, prazo e 5xx sao "nao sei".
 */
export async function reembolsaOrdem(
  provedorId: string,
  idempotencia: string
): Promise<RespostaDoEstorno> {
  return operaOrdem(provedorId, 'refund', idempotencia);
}

/**
 * `POST /v1/orders/{id}/{acao}` sem corpo — a forma comum de cancelar e de
 * estornar. Uma funcao so para as duas lerem o HTTP do mesmo jeito: a
 * diferenca entre "nao posso" e "nao sei" e dinheiro, e nao pode depender de
 * qual botao a pessoa apertou.
 */
async function operaOrdem(
  provedorId: string,
  acao: 'cancel' | 'refund',
  idempotencia: string
): Promise<RespostaDoCancelamento> {
  // Fora do try pelo mesmo motivo de `criaOrdem`: variavel faltando nao pode
  // virar "provedor indisponivel".
  const autorizacao = `Bearer ${token()}`;

  let resposta: Response;

  try {
    resposta = await fetch(`${base()}/v1/orders/${encodeURIComponent(provedorId)}/${acao}`, {
      method: 'POST',
      headers: { Authorization: autorizacao, 'X-Idempotency-Key': idempotencia },
      signal: AbortSignal.timeout(PRAZO_MS),
      cache: 'no-store',
    });
  } catch {
    return { ok: false, motivo: 'indisponivel' };
  }

  // Nunca logar o corpo: ele carrega dado do pagador.
  if (resposta.status === 404) return { ok: false, motivo: 'inexistente' };
  if (resposta.status >= 500) return { ok: false, motivo: 'indisponivel' };
  if (!resposta.ok) return { ok: false, motivo: 'invalido' };

  const ordem = (await resposta.json().catch(() => ({}))) as OrdemDoProvedor;
  const resumo = resumoDaOrdem(ordem);

  return { ok: true, status: resumo.status, statusDetail: resumo.statusDetail };
}

/** RFC 3339 sem fracao de segundo, a forma dos exemplos da documentacao. */
function rfc3339(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Busca as ordens que o provedor tem para um `external_reference` — o id do
 * pedido, que toda tentativa manda igual (#5, #14).
 *
 * E assim que uma tentativa cuja resposta se perdeu (timeout, deploy no meio)
 * reencontra a ordem que o provedor criou mesmo assim, sem a gente ter o id
 * dela. `begin_date` e `end_date` sao obrigatorios na API; quem chama passa a
 * janela em que a ordem pode ter nascido, e isso tambem deixa de fora ordens
 * de tentativas anteriores, que sao mais velhas.
 *
 * Devolve a lista toda: pode haver mais de uma (uma recusada, uma aprovada).
 * Quem sabe qual e qual e quem conhece as linhas do pedido, nao este arquivo.
 */
export async function buscaOrdensPorReferencia(
  referencia: string,
  janela: { desdeMs: number; ateMs: number }
): Promise<{ ok: true; ordens: OrdemEncontrada[] } | { ok: false }> {
  const parametros = new URLSearchParams({
    external_reference: referencia,
    begin_date: rfc3339(janela.desdeMs),
    end_date: rfc3339(janela.ateMs),
  });

  try {
    const r = await fetch(`${base()}/v1/orders?${parametros}`, {
      headers: { Authorization: `Bearer ${token()}` },
      signal: AbortSignal.timeout(PRAZO_MS),
      cache: 'no-store',
    });

    if (!r.ok) return { ok: false };

    const corpo = (await r.json()) as { data?: unknown };

    // Forma que nao reconhecemos e "nao sei", nunca "nao ha": uma lista vazia
    // aqui autoriza cobrar de novo.
    if (!Array.isArray(corpo?.data)) return { ok: false };

    const ordens: OrdemEncontrada[] = [];
    for (const o of corpo.data as OrdemDoProvedor[]) {
      const e = encontrada(o);
      if (e) ordens.push(e);
    }

    return { ok: true, ordens };
  } catch {
    return { ok: false };
  }
}
