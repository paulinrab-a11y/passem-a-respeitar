import 'server-only';

import { clienteAdmin } from '@/lib/supabase/admin';
import { type PixDoProvedor, pixDaOrdem } from './orders-api';
import { expirou } from './validade-do-pedido';

/**
 * O Pix que a pessoa ja gerou e ainda pode pagar (Issue #369).
 *
 * Quem chama ja confirmou que o pedido e da sessao (`meuPedido`, com filtro
 * por dono e RLS). O client administrativo aqui e por causa do GRANT, nao da
 * RLS: `provedor_pagamento_id` nao e legivel pelo cliente, de proposito, e e
 * por ele que se pergunta ao provedor.
 *
 * So a ULTIMA tentativa conta. Se depois do Pix veio um cartao, a cobranca do
 * cartao ja encerrou o Pix (`encerraAbertas`, #6) — e mesmo que nao tivesse
 * encerrado, mostrar um QR antigo por cima de uma tentativa mais nova seria
 * contar a historia fora de ordem. Pedido fora do prazo nao mostra Pix nenhum:
 * a tela nem chega aqui, mas a regra fica onde a decisao e tomada.
 *
 * Nada e gravado: o QR continua so no provedor. Qualquer duvida — banco,
 * provedor, ordem que mudou — vira `null`, e a tela mostra o formulario como
 * antes.
 */
export async function pixPendente(
  pedidoId: string,
  criadoEm: string,
  agoraMs = Date.now()
): Promise<PixDoProvedor | null> {
  if (expirou(criadoEm, agoraMs)) return null;

  const { data, error } = await clienteAdmin()
    .from('pagamentos')
    .select('metodo, estado, provedor_pagamento_id')
    .eq('order_id', pedidoId)
    .order('tentativa', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  if (data.metodo !== 'pix' || data.estado !== 'pendente' || !data.provedor_pagamento_id) {
    return null;
  }

  return pixDaOrdem(data.provedor_pagamento_id, agoraMs);
}
