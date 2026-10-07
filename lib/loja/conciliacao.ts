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
 * Linha com id do provedor e confirmada pela ordem. Linha SEM id — a resposta
 * da cobranca se perdeu — e procurada pela referencia (#5): a ordem pode
 * existir la, ate aprovada, e ninguem mais vai avisar.
 *
 * De proposito, NAO se filtra pelo status do pedido: um pagamento aprovado
 * de pedido que o dono cancelou e exatamente o que precisa aparecer, e ao
 * aplicar ele vira aviso ao dono em vez de `pago` (#21, #24).
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
import { EM_ABERTO } from './estado-do-pagamento';
import { casaOrfa, confirmaPeloProvedor, type ResultadoDoWebhook } from './webhook';

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

/**
 * Ate quando uma linha sem id do provedor ainda e procurada la. A ordem, se
 * existe, nasce segundos depois da linha; um dia depois sem aparecer e porque
 * nunca existiu, e a varredura nao deve carregar essas linhas para sempre.
 * Webhook atrasado para uma delas ainda casa pela referencia.
 */
const JANELA_DA_ORFA_MS = 24 * 60 * 60 * 1000;

type Linha = {
  id: string;
  order_id: string;
  estado: string;
  provedor_pagamento_id: string | null;
  criado_em: string;
};

type Admin = ReturnType<typeof clienteAdmin>;

function soma(balanco: Balanco, r: ResultadoDoWebhook) {
  if (r.tipo === 'aplicado') balanco.mudados += 1;
  else if (r.tipo === 'tente-de-novo') balanco.falhas += 1;
  else if (r.tipo === 'ignorado' && r.motivo === 'evento-repetido') balanco.repetidos += 1;
  else balanco.semAvanco += 1;
}

/**
 * Com id, confirma a ordem; sem id, procura a ordem pela referencia. Os dois
 * caminhos terminam na mesma aplicacao idempotente do webhook.
 */
function conferePeloProvedor(admin: Admin, p: Linha, agoraMs: number) {
  const pagamento = { id: p.id, order_id: p.order_id, estado: p.estado };

  return p.provedor_pagamento_id
    ? confirmaPeloProvedor(admin, pagamento, p.provedor_pagamento_id, 'conciliacao')
    : casaOrfa(admin, { ...pagamento, criado_em: p.criado_em }, 'conciliacao', agoraMs);
}

/**
 * Com id do provedor, qualquer idade. Sem id, so dentro da janela em que a
 * ordem ainda pode aparecer la.
 */
function comIdOuRecente(agoraMs: number): string {
  const corteDaOrfa = new Date(agoraMs - JANELA_DA_ORFA_MS).toISOString();

  return `provedor_pagamento_id.not.is.null,criado_em.gte.${corteDaOrfa}`;
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
    .select('id, order_id, estado, provedor_pagamento_id, criado_em')
    .eq('provedor', 'mercadopago')
    .in('estado', [...EM_ABERTO])
    .lt('criado_em', corte)
    .or(comIdOuRecente(agoraMs))
    .order('criado_em', { ascending: true })
    .limit(limite);

  const balanco: Balanco = { olhados: 0, mudados: 0, semAvanco: 0, repetidos: 0, falhas: 0 };

  // Um por vez, de proposito. Sao poucos, e em paralelo seria uma rajada no
  // provedor vinda de um IP so — o mesmo padrao que o rate limit deles pune.
  for (const p of pendentes ?? []) {
    balanco.olhados += 1;

    // Uma falha nao para a varredura: o proximo pode estar pago.
    const r = await conferePeloProvedor(admin, p, agoraMs);
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
    .select('id, order_id, estado, provedor_pagamento_id, criado_em')
    .eq('provedor', 'mercadopago')
    .eq('order_id', orderId)
    .in('estado', [...EM_ABERTO])
    .lt('criado_em', corte)
    .or(comIdOuRecente(agoraMs))
    .order('tentativa', { ascending: false })
    .limit(3);

  let mudou = false;

  for (const p of pendentes ?? []) {
    const r = await conferePeloProvedor(admin, p, agoraMs);
    if (r.tipo === 'aplicado') mudou = true;
  }

  return mudou;
}
