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
  let resposta: Response;

  try {
    resposta = await fetch(`${BASE}/v1/orders`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token()}`,
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

  const resumo = montaEstado(
    pagamento?.status ?? ordem.status,
    pagamento?.status_detail ?? ordem.status_detail
  );

  const meio = pagamento?.payment_method;

  return {
    ok: true,
    provedorId: String(ordem.id ?? pagamento?.id ?? ''),
    resumo,
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
