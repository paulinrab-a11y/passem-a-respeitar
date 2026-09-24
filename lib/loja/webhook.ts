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
  | { tipo: 'tente-de-novo'; motivo: string };

type Notificacao = {
  id?: string | number;
  type?: string;
  topic?: string;
  action?: string;
  data?: { id?: string | number };
};

export async function processa(
  corpo: unknown,
  recursoIdDaQuery: string | null
): Promise<ResultadoDoWebhook> {
  const n = (corpo ?? {}) as Notificacao;

  // O id do recurso pode vir na query ou no corpo. A assinatura ja foi
  // conferida contra o da query, entao ele e o que vale.
  const recursoId = recursoIdDaQuery ?? (n.data?.id != null ? String(n.data.id) : null);
  if (!recursoId) return { tipo: 'ignorado', motivo: 'sem-recurso' };

  // Identidade do EVENTO, nao da entrega. O provedor reenvia a mesma
  // notificacao com o mesmo `id` de corpo; usar o `x-request-id`, que muda a
  // cada tentativa, faria cada reenvio parecer novidade.
  const eventoId = n.id != null ? String(n.id) : recursoId;

  const admin = clienteAdmin();

  const { data: pagamento } = await admin
    .from('pagamentos')
    .select('id, order_id, estado')
    .eq('provedor', 'mercadopago')
    .eq('provedor_pagamento_id', recursoId)
    .maybeSingle();

  // Insere ANTES de processar. Se conflitar, este evento ja passou por aqui —
  // e nao se faz nada de novo. A idempotencia nao depende de lembrar de
  // checar; depende do indice recusar.
  const { error: erroEvento } = await admin.from('pagamento_eventos').insert({
    pagamento_id: pagamento?.id ?? null,
    evento_id: eventoId,
    tipo: n.type ?? n.topic ?? n.action ?? null,
  });

  if (erroEvento) {
    // 23505 = unique_violation. Reenvio, que e o caso comum e esperado.
    if (erroEvento.code === '23505') return { tipo: 'ignorado', motivo: 'evento-repetido' };
    return { tipo: 'tente-de-novo', motivo: 'nao-consegui-registrar' };
  }

  // Notificacao de recurso que nao conhecemos. Ja ficou registrada acima, para
  // a conciliacao saber que chegou.
  if (!pagamento) return { tipo: 'ignorado', motivo: 'pagamento-desconhecido' };

  // AQUI: o estado vem do provedor, nao do corpo.
  const resumo = await consultaOrdem(recursoId);
  if (!resumo) return { tipo: 'tente-de-novo', motivo: 'nao-consegui-confirmar' };

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
