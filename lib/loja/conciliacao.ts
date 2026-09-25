import 'server-only';

/**
 * Conciliacao de pagamentos pendentes (Issue #114).
 *
 * O webhook e um empurrao do provedor, e empurrao pode nao chegar: entrega
 * perdida, URL fora do ar durante um deploy, assinatura que o provedor muda
 * sem avisar (#45). Um Pix pago que fica `aguardando_pagamento` para sempre
 * e um cliente que nao recebe a camiseta.
 *
 * Isto e a rede de seguranca embaixo do webhook: pega o que esta parado em
 * `criado` ou `pendente` ha mais de alguns minutos e pergunta ao provedor,
 * pela mesma consulta e pela mesma regra de avanco que o webhook usa. Nao e
 * um segundo caminho de decisao — e o mesmo caminho, iniciado por nos.
 *
 * Dois gatilhos, porque nenhum sozinho basta:
 *
 *   - `concilia()`        varredura, chamada pelo cron. Pega a cauda longa.
 *   - `conciliaPedido()`  um pedido so, chamado quando a propria pessoa abre
 *                         a tela dele. Quem mais quer saber se pagou e quem
 *                         pagou, e ela chega antes de qualquer cron.
 */

import { limita } from '@/lib/rate-limit';
import { clienteAdmin } from '@/lib/supabase/admin';
import { confirmaPeloProvedor, type ResultadoDoWebhook } from './webhook';

/** O que uma varredura fez, para o log e para a resposta do cron. */
export type Balanco = {
  olhados: number;
  mudados: number;
  semAvanco: number;
  repetidos: number;
  falhas: number;
};

type Opcoes = {
  /** Teto por execucao, para nao estourar o tempo da funcao. */
  limite?: number;
  /**
   * Idade minima. Recem-criado ainda esta no meio da propria cobranca — a
   * resposta sincrona do provedor pode nem ter sido gravada. Deixar a poeira
   * baixar evita conciliar o que o proprio `cobra()` ja vai escrever.
   */
  idadeMinMs?: number;
  /** Injetavel para o teste nao depender do relogio. */
  agoraMs?: number;
};

const PADRAO = { limite: 50, idadeMinMs: 2 * 60 * 1000 };

/** Estados que ainda podem mudar por iniciativa do provedor. */
const EM_ABERTO = ['criado', 'pendente'] as const;

function soma(balanco: Balanco, r: ResultadoDoWebhook) {
  if (r.tipo === 'aplicado') balanco.mudados += 1;
  else if (r.tipo === 'tente-de-novo') balanco.falhas += 1;
  else if (r.tipo === 'ignorado' && r.motivo === 'evento-repetido') balanco.repetidos += 1;
  else balanco.semAvanco += 1;
}

export async function concilia({
  limite = PADRAO.limite,
  idadeMinMs = PADRAO.idadeMinMs,
  agoraMs = Date.now(),
}: Opcoes = {}): Promise<Balanco> {
  const admin = clienteAdmin();
  const corte = new Date(agoraMs - idadeMinMs).toISOString();

  const { data: pendentes } = await admin
    .from('pagamentos')
    .select('id, order_id, estado, provedor_pagamento_id')
    .eq('provedor', 'mercadopago')
    .in('estado', [...EM_ABERTO])
    .not('provedor_pagamento_id', 'is', null)
    .lt('criado_em', corte)
    .order('criado_em', { ascending: true })
    .limit(limite);

  const balanco: Balanco = { olhados: 0, mudados: 0, semAvanco: 0, repetidos: 0, falhas: 0 };

  // Um por vez, de proposito. Sao poucos, e em paralelo seria uma rajada no
  // provedor vinda de um IP so — o mesmo padrao que o rate limit deles pune.
  for (const p of pendentes ?? []) {
    // O `not is null` acima ja garante; o `if` e para o tipo.
    if (!p.provedor_pagamento_id) continue;

    balanco.olhados += 1;

    // Uma falha nao para a varredura: o proximo pode estar pago.
    const r = await confirmaPeloProvedor(
      admin,
      { id: p.id, order_id: p.order_id, estado: p.estado },
      p.provedor_pagamento_id,
      'conciliacao'
    );
    soma(balanco, r);
  }

  return balanco;
}

/**
 * Concilia os pagamentos em aberto de UM pedido. Para a tela do pedido.
 *
 * Quem chama ja provou que o pedido e da pessoa (`meuPedido`), e por isso
 * isto nao confere dono de novo — mas tambem nao devolve nada alem de "mudou
 * ou nao": a tela reconsulta pelo caminho normal, com RLS.
 *
 * Limitado a uma consulta por minuto por pedido. F5 em sequencia nao vira
 * rajada no provedor.
 */
export async function conciliaPedido(orderId: string, agoraMs = Date.now()): Promise<boolean> {
  const cota = await limita(`concilia:${orderId}`, 1, 60 * 1000);
  if (!cota.permitido) return false;

  const admin = clienteAdmin();

  // Aqui a idade minima e curta: a pessoa acabou de pagar e esta olhando. Mas
  // nao e zero — a cobranca sincrona pode ainda estar gravando.
  const corte = new Date(agoraMs - 15 * 1000).toISOString();

  const { data: pendentes } = await admin
    .from('pagamentos')
    .select('id, order_id, estado, provedor_pagamento_id')
    .eq('provedor', 'mercadopago')
    .eq('order_id', orderId)
    .in('estado', [...EM_ABERTO])
    .not('provedor_pagamento_id', 'is', null)
    .lt('criado_em', corte)
    .order('tentativa', { ascending: false })
    .limit(3);

  let mudou = false;

  for (const p of pendentes ?? []) {
    if (!p.provedor_pagamento_id) continue;

    const r = await confirmaPeloProvedor(
      admin,
      { id: p.id, order_id: p.order_id, estado: p.estado },
      p.provedor_pagamento_id,
      'conciliacao'
    );
    if (r.tipo === 'aplicado') mudou = true;
  }

  return mudou;
}
