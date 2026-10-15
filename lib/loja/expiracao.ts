import 'server-only';

/**
 * Pedido que passou do prazo de pagamento vira `cancelado` (#298, achado #25
 * da auditoria).
 *
 * O prazo mora em validade-do-pedido.ts. A cobranca e a tela recusam pagar
 * depois dele; isto aqui e o que tira o pedido de `aguardando_pagamento` de
 * verdade, para ele nao segurar a peca no estoque nem ficar com cara de
 * pagavel em "Meus pedidos".
 *
 * Cancelar passa pelo mesmo caminho do botao do dono (#21), na mesma ordem:
 *
 *   1. orfas       tentativa cuja resposta se perdeu e reencontrada no
 *                  provedor (#5). Aprovada la, o pedido virou `pago` e nao se
 *                  cancela; sem como perguntar, fica para a proxima rodada.
 *   2. abertas     a cobranca viva no provedor e cancelada ANTES do pedido.
 *                  Um Pix pagavel num pedido cancelado e dinheiro entrando sem
 *                  ninguem saber. Paga la, o pedido nao e cancelado nunca; sem
 *                  como cancelar, fica para a proxima rodada.
 *   3. pedido      `update` condicionado a `aguardando_pagamento`: se um
 *                  webhook aprovou no meio, nada e sobrescrito. A trilha da
 *                  #18 registra sem autor, como toda automacao, e o trigger da
 *                  #296 devolve a peca.
 *
 * Dois gatilhos, como a conciliacao: o cron (`expiraVencidos`), que pega todo
 * mundo uma vez por dia, e a tela do pedido (`expiraPedido`), para quem volta
 * ver "Cancelado" na hora e poder comprar de novo sem esperar o cron.
 */

import { limita } from '@/lib/rate-limit';
import { clienteAdmin } from '@/lib/supabase/admin';
import { VALIDADE_DO_PEDIDO_MS } from './validade-do-pedido';
import { casaOrfa, encerraAbertas, orfasDoPedido } from './webhook';

/** O que uma varredura fez, para o log e para a resposta do cron. */
export type BalancoDaExpiracao = {
  olhados: number;
  expirados: number;
  /** Tinham pagamento aprovado, descoberto agora ou ja aplicado. Nao expiram. */
  pagos: number;
  /** O provedor nao deixou concluir. Continuam aguardando; o proximo cron tenta. */
  adiados: number;
  /**
   * A varredura parou no teto ou no tempo com vencidos ainda na fila. No log,
   * e o sinal de que um dia so nao esta dando conta.
   */
  sobraram: boolean;
};

type Desfecho = 'expirado' | 'pago' | 'adiado' | 'saiu';

type Admin = ReturnType<typeof clienteAdmin>;

/**
 * Folga entre o fim do prazo e o cancelamento. A cobranca confere o prazo
 * antes de gravar a tentativa e de falar com o provedor; uma que passou na
 * porta um instante antes do fim ainda termina depois dele. Quinze minutos
 * cobrem com sobra o `maxDuration` da funcao, e assim nenhuma cobranca nasce
 * num pedido que ja foi cancelado.
 */
const FOLGA_MS = 15 * 60 * 1000;

/** Quantos pedidos se buscam por vez no banco. */
const LOTE = 25;

/** Teto por execucao: cada pedido pode custar algumas idas ao provedor. */
const LIMITE = 100;

/**
 * Tempo da varredura, contado do inicio dela. O cron roda uma vez por dia e
 * divide a funcao com a conciliacao: passado isto, para e o resto fica para
 * amanha, com `sobraram` no balanco.
 */
const ORCAMENTO_MS = 20 * 1000;

function corte(agoraMs: number): string {
  return new Date(agoraMs - VALIDADE_DO_PEDIDO_MS - FOLGA_MS).toISOString();
}

async function expira(admin: Admin, orderId: string, agoraMs: number): Promise<Desfecho> {
  for (const orfa of await orfasDoPedido(admin, orderId)) {
    const r = await casaOrfa(admin, orfa, 'expiracao', agoraMs);

    if (r.tipo === 'aplicado' && r.estado === 'aprovado') return 'pago';
    if (r.tipo === 'tente-de-novo' || (r.tipo === 'ignorado' && r.motivo === 'ja-vinculado')) {
      return 'adiado';
    }
    // Sem ordem no provedor, a tentativa nunca chegou la. A cobranca espera
    // um minuto antes de concluir isso; aqui a mais nova tem pelo menos a
    // folga, porque nenhuma nasce depois do prazo.
  }

  const abertas = await encerraAbertas(admin, orderId, 'expiracao');
  if (abertas.aprovadas > 0) return 'pago';
  if (abertas.presas > 0) return 'adiado';

  const { data, error } = await admin
    .from('orders')
    .update({ status: 'cancelado' })
    .eq('id', orderId)
    .eq('status', 'aguardando_pagamento')
    .select('id');

  if (error) return 'adiado';
  // Zero linhas: o pedido saiu da espera por outro caminho (pago, cancelado
  // pelo dono) enquanto isto rodava. Nao ha o que fazer.
  return data?.length ? 'expirado' : 'saiu';
}

/**
 * Varredura do cron: pedidos em `aguardando_pagamento` alem do prazo e da
 * folga, do mais velho para o mais novo.
 *
 * Em lotes, andando pela fila por `criado_em`, e nao "os 25 mais velhos": um
 * pedido adiado (o provedor nao deixou cancelar o Pix, a orfa nao responde)
 * continua aguardando e voltaria no topo todo dia. Com a fila parada nele, 25
 * adiados bastavam para nenhum pedido mais novo expirar nunca. Aqui o lote
 * seguinte comeca depois do ultimo olhado, e o adiado so custa a sua vez.
 */
export async function expiraVencidos({
  limite = LIMITE,
  lote = LOTE,
  orcamentoMs = ORCAMENTO_MS,
  agoraMs = Date.now(),
}: {
  limite?: number;
  lote?: number;
  orcamentoMs?: number;
  agoraMs?: number;
} = {}): Promise<BalancoDaExpiracao> {
  const admin = clienteAdmin();
  const inicio = Date.now();
  const ate = corte(agoraMs);

  const balanco: BalancoDaExpiracao = {
    olhados: 0,
    expirados: 0,
    pagos: 0,
    adiados: 0,
    sobraram: false,
  };

  let depoisDe: string | null = null;

  for (;;) {
    let busca = admin
      .from('orders')
      .select('id, criado_em')
      .eq('status', 'aguardando_pagamento')
      .lt('criado_em', ate);
    if (depoisDe) busca = busca.gt('criado_em', depoisDe);

    const pedidos = Math.min(lote, limite - balanco.olhados);
    const { data: vencidos } = await busca.order('criado_em', { ascending: true }).limit(pedidos);

    // Um por vez, como a conciliacao: rajada no provedor e o que o limite
    // deles pune. E um adiado nao para a fila: o proximo pode cancelar.
    for (const { id, criado_em } of vencidos ?? []) {
      if (Date.now() - inicio >= orcamentoMs) {
        balanco.sobraram = true;
        return balanco;
      }

      balanco.olhados += 1;
      depoisDe = criado_em;

      const desfecho = await expira(admin, id, agoraMs);
      if (desfecho === 'expirado') balanco.expirados += 1;
      else if (desfecho === 'pago') balanco.pagos += 1;
      else if (desfecho === 'adiado') balanco.adiados += 1;
    }

    // Lote incompleto: a fila acabou.
    if ((vencidos?.length ?? 0) < pedidos) return balanco;

    if (balanco.olhados >= limite) {
      balanco.sobraram = true;
      return balanco;
    }
  }
}

/**
 * Expira UM pedido, se ele passou do prazo. Para a tela do pedido.
 *
 * Quem chama ja provou que o pedido e da pessoa (`meuPedido`). O status e o
 * prazo sao relidos aqui, do banco: a tela so diz qual pedido, nunca que ele
 * venceu. A resposta e so "cancelou ou nao"; a tela reconsulta pelo caminho
 * normal, com RLS.
 *
 * Uma tentativa por minuto por pedido: F5 em sequencia nao vira rajada no
 * provedor.
 */
export async function expiraPedido(orderId: string, agoraMs = Date.now()): Promise<boolean> {
  const admin = clienteAdmin();

  const { data: vencido } = await admin
    .from('orders')
    .select('id')
    .eq('id', orderId)
    .eq('status', 'aguardando_pagamento')
    .lt('criado_em', corte(agoraMs))
    .maybeSingle();

  if (!vencido) return false;

  const cota = await limita(`expira:${orderId}`, 1, 60 * 1000);
  if (!cota.permitido) return false;

  return (await expira(admin, orderId, agoraMs)) === 'expirado';
}
