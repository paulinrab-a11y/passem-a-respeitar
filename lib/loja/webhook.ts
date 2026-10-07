import 'server-only';

/**
 * Processamento da notificacao do Mercado Pago (Issue #45).
 *
 * Tres barreiras, nesta ordem, e cada uma sozinha ja impediria uma classe de
 * fraude:
 *
 *   1. ASSINATURA   o corpo veio mesmo do Mercado Pago (assinatura-webhook.ts)
 *   2. REGISTRO     o evento e novo — o indice unico de `pagamento_eventos`
 *                   recusa o repetido, e a recusa E a idempotencia da auditoria
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
 *
 * TENTATIVA SEM RESPOSTA
 *
 * A cobranca grava a linha ANTES de chamar o provedor. Se a resposta se perde
 * (timeout, deploy no meio), a linha fica `criado` sem id — e a ordem pode
 * muito bem existir la, ate aprovada. `casaOrfa` reencontra essa ordem pelo
 * `external_reference` e a vincula a linha; a cobranca chama antes de abrir
 * tentativa nova (senao cobra duas vezes), a conciliacao chama pela cauda
 * longa, e o webhook faz o mesmo quando o recurso notificado nao bate com
 * linha nenhuma. (#5, #14)
 */

import { clienteAdmin } from '@/lib/supabase/admin';
import { EM_ABERTO, type EstadoInterno, emAberto, podeAvancar } from './estado-do-pagamento';
import {
  buscaOrdensPorReferencia,
  consultaOrdem,
  localizaOrdem,
  type OrdemEncontrada,
} from './orders-api';

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
 * Quem iniciou uma confirmacao que nao veio assinada pelo provedor. Vira o
 * prefixo do `evento_id` e o `tipo` em `pagamento_eventos`, para a auditoria
 * saber de onde veio.
 */
export type OrigemDaConfirmacao = 'nao-assinado' | 'conciliacao' | 'cobranca';

export type PagamentoEmAberto = { id: string; order_id: string; estado: string };

/** Tentativa que ficou sem id do provedor: a resposta se perdeu no caminho. */
export type PagamentoOrfao = PagamentoEmAberto & { criado_em: string };

type Admin = ReturnType<typeof clienteAdmin>;
type Resumo = NonNullable<Awaited<ReturnType<typeof consultaOrdem>>>;

/**
 * Folga entre o relogio do provedor e o nosso. A ordem nasce la DEPOIS da
 * linha aqui (a linha vem antes da chamada), entao ordem mais velha que a
 * linha, alem desta folga, nao pode ser dela.
 */
const FOLGA_DO_RELOGIO_MS = 5_000;

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

  // Insere ANTES de processar. Se conflitar, este evento ja passou por aqui.
  // Mas repetido NAO encerra: a entrega anterior pode ter morrido entre
  // registrar e aplicar — consulta ao provedor que falhou, processo derrubado
  // — e o reenvio existe justamente para isso. O indice deduplica a
  // auditoria; quem deduplica a aplicacao e `podeAvancar`. (#15)
  const registro = await registra(admin, eventoId, pagamento?.id ?? null, n);
  if (registro?.tipo === 'tente-de-novo') return registro;

  // Recurso que nao bate com linha nenhuma: pode ser a ordem de uma tentativa
  // cuja resposta se perdeu. O evento ja ficou registrado acima.
  if (!pagamento) return casaPeloRecurso(admin, recursoId, eventoId);

  // AQUI: o estado vem do provedor, nao do corpo.
  const resumo = await consultaOrdem(recursoId);
  if (!resumo) return { tipo: 'tente-de-novo', motivo: 'nao-consegui-confirmar' };

  const resultado = await aplica(admin, pagamento, resumo, eventoId);

  // Repetido e sem nada a aplicar continua contando como repetido: e o caso
  // comum do reenvio, e o log distingue "ja tinha visto" de "olhou e nao mudou".
  if (registro && resultado.tipo === 'ignorado') return registro;

  return resultado;
}

/**
 * Notificacao de ordem que nenhuma linha nossa conhece (#5, #14).
 *
 * O caso real: a cobranca estourou o prazo, a linha ficou `criado` sem id, e
 * o provedor — que processou mesmo assim — avisa por aqui. A ordem dele traz
 * o `external_reference`, que e o id do pedido; a tentativa sem id mais
 * recente desse pedido e a dona dela, desde que a ordem tenha nascido depois
 * da linha.
 */
async function casaPeloRecurso(
  admin: Admin,
  recursoId: string,
  eventoId: string
): Promise<ResultadoDoWebhook> {
  const localizacao = await localizaOrdem(recursoId);
  if (!localizacao.ok) return { tipo: 'tente-de-novo', motivo: 'nao-consegui-confirmar' };

  const ordem = localizacao.ordem;
  if (!ordem?.referencia) return { tipo: 'ignorado', motivo: 'pagamento-desconhecido' };

  const orfa = await orfaDoPedido(admin, ordem.referencia);
  if (!orfa || nasceuAntesDa(ordem, orfa)) {
    return { tipo: 'ignorado', motivo: 'pagamento-desconhecido' };
  }

  const vinculo = await vincula(admin, orfa.id, ordem.provedorId);
  if (vinculo) return vinculo;

  return aplica(admin, orfa, ordem.resumo, eventoId);
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

  return registraEAplica(admin, pagamento, resumo, recursoId, origem);
}

/**
 * Reencontra, no provedor, a ordem de uma tentativa que ficou sem id (#5, #14).
 *
 * A cobranca chama antes de abrir tentativa nova: se a anterior virou cobranca
 * de verdade do outro lado, abrir outra e cobrar duas vezes. A conciliacao
 * chama pela cauda longa — webhook que nao veio, cliente que nao voltou.
 *
 * Toda tentativa do pedido manda o mesmo `external_reference`, entao a busca
 * devolve as ordens de TODAS elas. As que ja tem dona (id em alguma linha)
 * saem; as que sobram sao pareadas com as tentativas sem id, da mais nova
 * para a mais nova. Ordem que nasceu antes da linha nao e dela.
 */
export async function casaOrfa(
  admin: Admin,
  orfa: PagamentoOrfao,
  origem: OrigemDaConfirmacao,
  agoraMs = Date.now()
): Promise<ResultadoDoWebhook> {
  const { data: linhas } = await admin
    .from('pagamentos')
    .select('id, estado, provedor_pagamento_id, criado_em')
    .eq('order_id', orfa.order_id)
    .order('tentativa', { ascending: false });

  const todas = linhas ?? [];
  const conhecidas = new Set(todas.map((l) => l.provedor_pagamento_id).filter((id) => id));
  const orfas = todas.filter((l) => l.provedor_pagamento_id === null && emAberto(l.estado));

  // Alguem vinculou no meio do caminho (webhook, outra aba). Nada a fazer aqui.
  const posicao = orfas.findIndex((l) => l.id === orfa.id);
  if (posicao < 0) return { tipo: 'ignorado', motivo: 'ja-vinculado' };

  // A janela comeca na orfa mais velha: ordem de tentativa anterior, que ja
  // tem dona ou foi recusada, fica de fora pela data.
  const maisVelha = orfas.at(-1) ?? orfa;
  const busca = await buscaOrdensPorReferencia(orfa.order_id, {
    desdeMs: Date.parse(maisVelha.criado_em) - FOLGA_DO_RELOGIO_MS,
    ateMs: agoraMs + FOLGA_DO_RELOGIO_MS,
  });
  if (!busca.ok) return { tipo: 'tente-de-novo', motivo: 'nao-consegui-confirmar' };

  const semDona = busca.ordens
    .filter((o) => !conhecidas.has(o.provedorId))
    .sort((a, b) => (b.criadaEmMs ?? 0) - (a.criadaEmMs ?? 0));

  const ordem = semDona[posicao];
  if (!ordem || nasceuAntesDa(ordem, orfa)) {
    return { tipo: 'ignorado', motivo: 'sem-ordem-no-provedor' };
  }

  const vinculo = await vincula(admin, orfa.id, ordem.provedorId);
  if (vinculo) return vinculo;

  return registraEAplica(admin, orfa, ordem.resumo, ordem.provedorId, origem);
}

/** A tentativa sem id mais recente do pedido que ainda esta em aberto. */
export async function orfaDoPedido(admin: Admin, orderId: string): Promise<PagamentoOrfao | null> {
  const { data } = await admin
    .from('pagamentos')
    .select('id, order_id, estado, criado_em')
    .eq('order_id', orderId)
    .is('provedor_pagamento_id', null)
    .in('estado', [...EM_ABERTO])
    .order('tentativa', { ascending: false })
    .limit(1);

  return data?.[0] ?? null;
}

function nasceuAntesDa(ordem: OrdemEncontrada, orfa: PagamentoOrfao): boolean {
  if (ordem.criadaEmMs === null) return false;

  return ordem.criadaEmMs < Date.parse(orfa.criado_em) - FOLGA_DO_RELOGIO_MS;
}

/** `null` = vinculado agora. Senao, o motivo de nao seguir. */
async function vincula(
  admin: Admin,
  pagamentoId: string,
  provedorId: string
): Promise<ResultadoDoWebhook | null> {
  // `is null` no filtro: se outro caminho (webhook, conciliacao, cobranca)
  // vinculou no meio, zero linhas mudam e nada e sobrescrito.
  const { data, error } = await admin
    .from('pagamentos')
    .update({ provedor_pagamento_id: provedorId })
    .eq('id', pagamentoId)
    .is('provedor_pagamento_id', null)
    .select('id');

  if (error) {
    // 23505 = este id ja esta em outra linha: alguem chegou antes.
    if (error.code === '23505') return { tipo: 'ignorado', motivo: 'ja-vinculado' };
    return { tipo: 'tente-de-novo', motivo: 'nao-consegui-vincular' };
  }
  if (!data?.length) return { tipo: 'ignorado', motivo: 'ja-vinculado' };

  return null;
}

/**
 * Registra o evento com identidade vinda do provedor e aplica.
 *
 * A identidade vem do que o PROVEDOR respondeu, nao de quem pediu. Um corpo
 * forjado nao escolhe o id — e por isso nao consegue ocupar de antemao o id
 * de um evento legitimo para fazer o real cair como repetido. Mesmo estado de
 * novo colide e vira "repetido"; estado novo processa.
 */
async function registraEAplica(
  admin: Admin,
  pagamento: PagamentoEmAberto,
  resumo: Resumo,
  provedorId: string,
  origem: OrigemDaConfirmacao
): Promise<ResultadoDoWebhook> {
  const eventoId = `${origem}:${provedorId}:${resumo.status}`;

  const registro = await registra(admin, eventoId, pagamento.id, null, origem);
  if (registro?.tipo === 'tente-de-novo') return registro;

  // Evento repetido NAO encerra aqui, e isso e de proposito. O indice unico
  // deduplica a auditoria; quem deduplica a aplicacao e `podeAvancar`, que ja
  // e idempotente. Encerrar no repetido deixaria um buraco sem cura: processo
  // caindo entre gravar o evento e atualizar o estado, e o pagamento preso
  // para sempre — exatamente o que a conciliacao existe para consertar.
  const resultado = await aplica(admin, pagamento, resumo, eventoId);

  // Repetido e sem nada a aplicar continua contando como repetido: o balanco
  // da conciliacao distingue "ja tinha visto" de "olhou e nao mudou".
  if (registro && resultado.tipo === 'ignorado') return registro;

  return resultado;
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

  // O evento pode ter sido registrado antes de se saber de que pagamento era
  // (recurso desconhecido que casou depois). Agora se sabe.
  const evento = { pagamento_id: pagamento.id, provedor_status: resumo.status };

  // Notificacao fora de ordem: uma antiga dizendo `pendente` nao derruba um
  // `aprovado` que ja chegou.
  if (!podeAvancar(atual, resumo.estado)) {
    await admin.from('pagamento_eventos').update(evento).eq('evento_id', eventoId);

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

  await admin.from('pagamento_eventos').update(evento).eq('evento_id', eventoId);

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
