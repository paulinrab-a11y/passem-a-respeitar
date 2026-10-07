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

import { montaEstado, type ResumoDoProvedor } from './estado-do-pagamento';

const BASE = 'https://api.mercadopago.com';

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

/** O que volta para quem chamou. Enxuto: nada de objeto cru do provedor. */
export type RespostaDaCobranca =
  | {
      ok: true;
      provedorId: string;
      resumo: ResumoDoProvedor;
      /** So em Pix. Vem do provedor, nunca gerado aqui. */
      pix?: { copiaECola: string; qrBase64: string | null; expiraEm: string | null };
    }
  | { ok: false; motivo: 'recusado' | 'invalido' | 'indisponivel'; resumo?: ResumoDoProvedor };

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
 * qual e o estado de verdade. `indisponivel` e nao ter conseguido perguntar.
 */
export type RespostaDoCancelamento =
  | { ok: true; status: string | null; statusDetail: string | null }
  | { ok: false; motivo: 'invalido' | 'indisponivel' };

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
    resposta = await fetch(`${BASE}/v1/orders`, {
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

  const ordem = (await resposta.json().catch(() => ({}))) as OrdemDoProvedor;
  const pagamento = ordem.transactions?.payments?.[0];

  if (!resposta.ok) {
    // 4xx e pedido malformado nosso ou cartao recusado; 5xx e problema la.
    // Nunca logar `ordem` inteira: ela carrega dado do pagador.
    return { ok: false, motivo: resposta.status >= 500 ? 'indisponivel' : 'invalido' };
  }

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
    const r = await fetch(`${BASE}/v1/orders/${encodeURIComponent(provedorId)}`, {
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
 * nao falha: quem chama pergunta o estado real. Rede, prazo e 5xx sao "nao
 * sei".
 */
export async function cancelaOrdem(
  provedorId: string,
  idempotencia: string
): Promise<RespostaDoCancelamento> {
  // Fora do try pelo mesmo motivo de `criaOrdem`: variavel faltando nao pode
  // virar "provedor indisponivel".
  const autorizacao = `Bearer ${token()}`;

  let resposta: Response;

  try {
    resposta = await fetch(`${BASE}/v1/orders/${encodeURIComponent(provedorId)}/cancel`, {
      method: 'POST',
      headers: { Authorization: autorizacao, 'X-Idempotency-Key': idempotencia },
      signal: AbortSignal.timeout(PRAZO_MS),
      cache: 'no-store',
    });
  } catch {
    return { ok: false, motivo: 'indisponivel' };
  }

  if (!resposta.ok) {
    // Nunca logar o corpo: ele carrega dado do pagador.
    return { ok: false, motivo: resposta.status >= 500 ? 'indisponivel' : 'invalido' };
  }

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
    const r = await fetch(`${BASE}/v1/orders?${parametros}`, {
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
