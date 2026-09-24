import 'server-only';

/**
 * Processamento da notificacao do Mercado Pago (Issue #45).
 *
 * Tres barreiras, nesta ordem, e cada uma sozinha ja impediria uma classe de
 * fraude:
 *
 *   1. ASSINATURA   o corpo veio mesmo do Mercado Pago (assinatura-webhook.ts)
 *   2. REGISTRO     o evento e novo — o indice unico de `pagamento_eventos`
 *                   recusa o repetido, e a recusa E a idempotencia
 *   3. CONFIRMACAO  o estado vem de uma consulta server-to-server, nunca do
 *                   corpo que chegou
 *
 * A terceira e a que mais importa e a que mais se esquece: assinatura valida
 * prova que a notificacao e autentica, nao que o `status` escrito nela ainda
 * vale. Um corpo assinado com `"status":"approved"` nao aprova nada aqui.
 *
 * SANDBOX, SEM ASSINATURA
 *
 * Com credenciais de teste, a entrega real do provedor vem assinada por uma
 * aplicacao-espelho cujo segredo o painel nao mostra — o simulador do painel
 * valida, a entrega real nao, e a equipe do provedor nao respondeu
 * (mercadopago/sdk-java#420, reproduzido por terceiros em Node e Checkout
 * Pro; em producao a assinatura valida). Nao ha o que configurar do nosso
 * lado.
 *
 * Entao a notificacao SEM assinatura valida tem um caminho proprio, e ele so
 * existe para ordem de teste — `ORDTST…`, prefixo do PROVEDOR, nao nosso. O
 * caminho e mais restrito que o assinado, nao menos: nada e gravado antes de
 * o provedor confirmar por API, e a identidade do evento e derivada do que o
 * provedor respondeu, nao do corpo. Quem forja so consegue nos fazer
 * perguntar a verdade ao Mercado Pago.
 *
 * Em producao isso e inerte por construcao: `pagamentos` nunca tem
 * `ORDTST…`, entao a busca falha antes de qualquer consulta, e ordem real
 * (`ORD01…`) sem assinatura e recusada na primeira linha.
 *
 * Esse mesmo "confirma primeiro, grava depois" e o que a conciliacao (#114)
 * usa — `confirmaPeloProvedor` e exportada por isso. Nao e um segundo caminho
 * de decisao: e o mesmo, iniciado por nos em vez de pelo provedor.
 */

import { clienteAdmin } from '@/lib/supabase/admin';
import { type EstadoInterno, podeAvancar } from './estado-do-pagamento';
import { consultaOrdem } from './orders-api';

export type ResultadoDoWebhook =
  /** Processado agora. */
  | { tipo: 'aplicado'; estado: EstadoInterno }
  /** Ja tinha sido processado, ou nao muda nada. Tambem e sucesso. */
  | { tipo: 'ignorado'; motivo: string }
  /** Nao deu para confirmar. O provedor reenvia. */
  | { tipo: 'tente-de-novo'; motivo: string }
  /** Sem assinatura e fora do sandbox. Reenviar nao ajuda. */
  | { tipo: 'recusado'; motivo: 'nao-assinado-fora-do-sandbox' };

type Notificacao = {
  id?: string | number;
  type?: string;
  topic?: string;
  action?: string;
  data?: { id?: string | number };
};

/** Marca do provedor em ordem criada com credencial de teste. */
const PREFIXO_SANDBOX = 'ORDTST';

/**
 * Quem iniciou uma confirmacao sem assinatura. Vira o prefixo do `evento_id`
 * e o `tipo` em `pagamento_eventos`, para a auditoria saber de onde veio.
 */
export type OrigemDaConfirmacao = 'nao-assinado' | 'conciliacao';

export type PagamentoEmAberto = { id: string; order_id: string; estado: string };
type Admin = ReturnType<typeof clienteAdmin>;
type Resumo = NonNullable<Awaited<ReturnType<typeof consultaOrdem>>>;

export async function processa(
  corpo: unknown,
  recursoIdDaQuery: string | null,
  { assinada }: { assinada: boolean }
): Promise<ResultadoDoWebhook> {
  const n = (corpo ?? {}) as Notificacao;

  // O id do recurso pode vir na query ou no corpo. A assinatura, quando ha, ja
  // foi conferida contra o da query, entao ele e o que vale.
  const recursoId = recursoIdDaQuery ?? (n.data?.id != null ? String(n.data.id) : null);
  if (!recursoId) return { tipo: 'ignorado', motivo: 'sem-recurso' };

  // Sem assinatura, so ordem de teste. A primeira linha, antes de tocar no
  // banco: ordem real sem prova de origem nao merece nem uma consulta.
  if (!assinada && !recursoId.startsWith(PREFIXO_SANDBOX)) {
    return { tipo: 'recusado', motivo: 'nao-assinado-fora-do-sandbox' };
  }

  const admin = clienteAdmin();

  const { data: pagamento } = await admin
    .from('pagamentos')
    .select('id, order_id, estado')
    .eq('provedor', 'mercadopago')
    .eq('provedor_pagamento_id', recursoId)
    .maybeSingle();

  if (assinada) return processaAssinada(admin, n, recursoId, pagamento);

  // Sem prova de origem, ruido nao entra na auditoria: quem nao provou nada
  // nao ganha uma linha em `pagamento_eventos`.
  if (!pagamento) return { tipo: 'ignorado', motivo: 'pagamento-desconhecido' };

  return confirmaPeloProvedor(admin, pagamento, recursoId, 'nao-assinado');
}

async function processaAssinada(
  admin: Admin,
  n: Notificacao,
  recursoId: string,
  pagamento: PagamentoEmAberto | null
): Promise<ResultadoDoWebhook> {
  // Identidade do EVENTO, nao da entrega. O provedor reenvia a mesma
  // notificacao com o mesmo `id` de corpo; usar o `x-request-id`, que muda a
  // cada tentativa, faria cada reenvio parecer novidade.
  const eventoId = n.id != null ? String(n.id) : recursoId;

  // Insere ANTES de processar. Se conflitar, este evento ja passou por aqui —
  // e nao se faz nada de novo. A idempotencia nao depende de lembrar de
  // checar; depende do indice recusar.
  const registro = await registra(admin, eventoId, pagamento?.id ?? null, n);
  if (registro) return registro;

  // Notificacao de recurso que nao conhecemos. Ja ficou registrada acima, para
  // a conciliacao saber que chegou.
  if (!pagamento) return { tipo: 'ignorado', motivo: 'pagamento-desconhecido' };

  // AQUI: o estado vem do provedor, nao do corpo.
  const resumo = await consultaOrdem(recursoId);
  if (!resumo) return { tipo: 'tente-de-novo', motivo: 'nao-consegui-confirmar' };

  return aplica(admin, pagamento, resumo, eventoId);
}

/**
 * Confirma um pagamento conhecido pelo provedor e aplica o que ele disser.
 *
 * Ordem inversa da assinada, de proposito: aqui a unica fonte de verdade e a
 * consulta, entao nada e gravado antes dela responder.
 */
export async function confirmaPeloProvedor(
  admin: Admin,
  pagamento: PagamentoEmAberto,
  recursoId: string,
  origem: OrigemDaConfirmacao
): Promise<ResultadoDoWebhook> {
  const resumo = await consultaOrdem(recursoId);
  if (!resumo) return { tipo: 'tente-de-novo', motivo: 'nao-consegui-confirmar' };

  // A identidade do evento vem do que o PROVEDOR respondeu, nao de quem
  // pediu. Um corpo forjado nao escolhe o id — e por isso nao consegue ocupar
  // de antemao o id de um evento legitimo para fazer o real cair como
  // repetido. Mesmo estado de novo colide e vira "repetido"; estado novo
  // processa.
  const eventoId = `${origem}:${recursoId}:${resumo.status}`;

  const registro = await registra(admin, eventoId, pagamento.id, null, origem);
  if (registro) return registro;

  return aplica(admin, pagamento, resumo, eventoId);
}

/** `null` = registrado agora. Senao, o motivo de nao seguir. */
async function registra(
  admin: Admin,
  eventoId: string,
  pagamentoId: string | null,
  n: Notificacao | null,
  origem?: OrigemDaConfirmacao
): Promise<ResultadoDoWebhook | null> {
  const { error } = await admin.from('pagamento_eventos').insert({
    pagamento_id: pagamentoId,
    evento_id: eventoId,
    tipo: n ? (n.type ?? n.topic ?? n.action ?? null) : (origem ?? null),
  });

  if (!error) return null;
  // 23505 = unique_violation. Reenvio, que e o caso comum e esperado.
  if (error.code === '23505') return { tipo: 'ignorado', motivo: 'evento-repetido' };
  return { tipo: 'tente-de-novo', motivo: 'nao-consegui-registrar' };
}

async function aplica(
  admin: Admin,
  pagamento: PagamentoEmAberto,
  resumo: Resumo,
  eventoId: string
): Promise<ResultadoDoWebhook> {
  const atual = pagamento.estado as EstadoInterno;

  // Notificacao fora de ordem: uma antiga dizendo `pendente` nao derruba um
  // `aprovado` que ja chegou.
  if (!podeAvancar(atual, resumo.estado)) {
    await admin
      .from('pagamento_eventos')
      .update({ provedor_status: resumo.status })
      .eq('evento_id', eventoId);

    return { tipo: 'ignorado', motivo: 'sem-avanco' };
  }

  await admin
    .from('pagamentos')
    .update({
      estado: resumo.estado,
      provedor_status: resumo.status,
      provedor_status_detail: resumo.statusDetail,
    })
    .eq('id', pagamento.id);

  await admin
    .from('pagamento_eventos')
    .update({ provedor_status: resumo.status })
    .eq('evento_id', eventoId);

  // O eixo comercial so anda quando o financeiro aprova. Recusa nao cancela o
  // pedido: cabe outra tentativa, e e para isso que `pagamentos.tentativa`
  // existe. A trilha de status e escrita sozinha pelo trigger da #18.
  if (resumo.estado === 'aprovado') {
    await admin
      .from('orders')
      .update({ status: 'pago' })
      .eq('id', pagamento.order_id)
      .eq('status', 'aguardando_pagamento');
  }

  return { tipo: 'aplicado', estado: resumo.estado };
}
