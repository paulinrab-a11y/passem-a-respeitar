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
 * linha nenhuma. Qual ordem e de qual linha se decide pelo TEMPO: a ordem de
 * uma tentativa nasce depois dela e antes da tentativa seguinte, e so. (#5,
 * #14)
 *
 * UMA COBRANCA VIVA POR PEDIDO
 *
 * Pix pendente e cartao aprovado no mesmo pedido e o cliente pagando duas
 * vezes sem ninguem perceber: o segundo `aprovado` so encontra um pedido que
 * ja esta `pago` e nao muda nada. Por isso `encerraAbertas` cancela, aqui e
 * no provedor, as tentativas abertas que sobraram — a cobranca chama antes de
 * abrir outra, o dono chama ao cancelar o pedido, e `aplica` chama quando uma
 * e aprovada. E dinheiro que entra onde nao devia (pedido ja pago por outra
 * tentativa, pedido cancelado) vira aviso ao dono em vez de silencio. (#6,
 * #11, #21, #24)
 *
 * DINHEIRO QUE VOLTA
 *
 * O caminho de volta tem dois lados, e os dois passam por aqui. Estorno ou
 * chargeback feito no provedor — o dono pelo painel dele, o cliente
 * contestando o cartao — chega como `estornado`, e `aplica` leva o pedido a
 * `reembolsado` e avisa: antes o pedido seguia "pago" e o dono produzia uma
 * camiseta cujo dinheiro ja tinha voltado (#7). E o botao "Reembolsar" do
 * painel chama `estornaAprovadas` ANTES de mudar o status: estorna la, marca
 * aqui, e se o provedor nao estornar o pedido nao muda — antes o botao so
 * trocava o rotulo (#22).
 */

import { createHash } from 'node:crypto';
import * as Sentry from '@sentry/nextjs';
import { clienteAdmin } from '@/lib/supabase/admin';
import { EM_ABERTO, type EstadoInterno, emAberto, podeAvancar } from './estado-do-pagamento';
import {
  buscaOrdensPorReferencia,
  cancelaOrdem,
  consultaOrdem,
  localizaOrdem,
  type OrdemEncontrada,
  reembolsaOrdem,
} from './orders-api';
import { origensDe } from './status-do-pedido';

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
 * saber de onde veio. `webhook` e `admin` aparecem quando, ao encerrar as
 * tentativas abertas de um pedido, uma delas precisa ser confirmada.
 */
export type OrigemDaConfirmacao = 'nao-assinado' | 'conciliacao' | 'cobranca' | 'webhook' | 'admin';

export type PagamentoEmAberto = { id: string; order_id: string; estado: string };

/** O que `encerraAbertas` fez com as tentativas abertas de um pedido. */
export type Encerramento = {
  /** Canceladas agora, descobertas ja finais no provedor, ou que ele nao tem. */
  encerradas: number;
  /** Aprovadas: ja estavam, ou se descobriram ao tentar cancelar. */
  aprovadas: number;
  /** Nao deu para cancelar nem para saber o estado. Continuam abertas. */
  presas: number;
};

/** O que `estornaAprovadas` fez com as tentativas aprovadas de um pedido (#22). */
export type Estorno = {
  /** Estornadas agora no provedor, ou descobertas ja estornadas la. */
  estornadas: number;
  /** Ja estavam `estornado` aqui: o dinheiro tinha voltado por outro caminho. */
  jaEstornadas: number;
  /** O provedor nao deixou estornar e, consultada, a ordem segue paga la. */
  recusadas: number;
  /** Nao deu para estornar nem para saber o estado. Continuam aprovadas. */
  presas: number;
};

/** Mensagens de aviso ao dono. Fechadas aqui para o Sentry agrupar por texto. */
type AvisoDePagamento =
  | 'pagamento aprovado em pedido nao pendente'
  | 'pagamento duplicado a estornar'
  | 'pagamento estornado no provedor: pedido reembolsado';

/** Tentativa que ficou sem id do provedor: a resposta se perdeu no caminho. */
export type PagamentoOrfao = PagamentoEmAberto & { criado_em: string };

/** Uma tentativa do pedido, como `linhasDoPedido` devolve. */
type LinhaDoPedido = PagamentoOrfao & { provedor_pagamento_id: string | null };

type Admin = ReturnType<typeof clienteAdmin>;
type Resumo = NonNullable<Awaited<ReturnType<typeof consultaOrdem>>>;

/**
 * Folga entre o relogio do provedor e o nosso. A ordem nasce la DEPOIS da
 * linha aqui (a linha vem antes da chamada), entao ordem mais velha que a
 * linha, alem desta folga, nao pode ser dela — e, pelo mesmo motivo, ordem
 * mais velha que a tentativa SEGUINTE, alem da folga, nao pode ser daquela.
 */
const FOLGA_DO_RELOGIO_MS = 5_000;

/** Marca, na coluna de detalhe, a cobranca cujo id o provedor diz nao ter. */
const ORDEM_INEXISTENTE = 'order_not_found';

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

  const resultado = await aplica(admin, pagamento, resumo, eventoId, 'webhook');

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
 * o `external_reference`, que e o id do pedido; a dona dela e a tentativa sem
 * id desse pedido em cuja epoca a ordem nasceu — nao a mais recente, que pode
 * ser outra tentativa que nunca chegou ao provedor.
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

  const orfa = donaDaOrdem(await linhasDoPedido(admin, ordem.referencia), ordem);
  if (!orfa) return { tipo: 'ignorado', motivo: 'pagamento-desconhecido' };

  const vinculo = await vincula(admin, orfa.id, ordem.provedorId);
  if (vinculo) return vinculo;

  return aplica(admin, orfa, ordem.resumo, eventoId, 'webhook');
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
 * saem; das que sobram, a desta orfa e a que nasceu na epoca dela (ver
 * `janelaDaOrdem`). Parear por posicao nao serve: uma orfa mais nova que
 * nunca chegou ao provedor esconderia a ordem — ate aprovada — da mais velha.
 */
export async function casaOrfa(
  admin: Admin,
  orfa: PagamentoOrfao,
  origem: OrigemDaConfirmacao,
  agoraMs = Date.now()
): Promise<ResultadoDoWebhook> {
  const todas = await linhasDoPedido(admin, orfa.order_id);
  const conhecidas = new Set(todas.map((l) => l.provedor_pagamento_id).filter((id) => id));
  const orfas = todas.filter(ehOrfa);

  // Alguem vinculou no meio do caminho (webhook, outra aba). Nada a fazer aqui.
  if (!orfas.some((l) => l.id === orfa.id)) return { tipo: 'ignorado', motivo: 'ja-vinculado' };

  // A janela comeca na orfa mais velha: ordem de tentativa anterior, que ja
  // tem dona ou foi recusada, fica de fora pela data.
  const maisVelha = orfas.at(-1) ?? orfa;
  const busca = await buscaOrdensPorReferencia(orfa.order_id, {
    desdeMs: Date.parse(maisVelha.criado_em) - FOLGA_DO_RELOGIO_MS,
    ateMs: agoraMs + FOLGA_DO_RELOGIO_MS,
  });
  if (!busca.ok) return { tipo: 'tente-de-novo', motivo: 'nao-consegui-confirmar' };

  const janela = janelaDaOrdem(todas, orfa.id);
  const ordem = busca.ordens
    .filter((o) => !conhecidas.has(o.provedorId) && naJanela(o, janela))
    // A mais nova da janela: uma tentativa recusada segundos antes desta pode
    // ter deixado uma ordem sem dona na borda, e a desta e a que veio depois.
    // Sem data vai por ultimo — nao da para excluir, mas tambem nao desempata.
    .sort((a, b) => (b.criadaEmMs ?? -1) - (a.criadaEmMs ?? -1))[0];
  if (!ordem) return { tipo: 'ignorado', motivo: 'sem-ordem-no-provedor' };

  const vinculo = await vincula(admin, orfa.id, ordem.provedorId);
  if (vinculo) return vinculo;

  return registraEAplica(admin, orfa, ordem.resumo, ordem.provedorId, origem);
}

/** As tentativas sem id do pedido que ainda estao em aberto, da mais nova para a mais velha. */
export async function orfasDoPedido(admin: Admin, orderId: string): Promise<PagamentoOrfao[]> {
  const { data } = await admin
    .from('pagamentos')
    .select('id, order_id, estado, criado_em')
    .eq('order_id', orderId)
    .is('provedor_pagamento_id', null)
    .in('estado', [...EM_ABERTO])
    .order('tentativa', { ascending: false });

  return data ?? [];
}

/** Todas as tentativas do pedido, da mais nova para a mais velha. */
async function linhasDoPedido(admin: Admin, orderId: string): Promise<LinhaDoPedido[]> {
  const { data } = await admin
    .from('pagamentos')
    .select('id, order_id, estado, provedor_pagamento_id, criado_em')
    .eq('order_id', orderId)
    .order('tentativa', { ascending: false });

  return data ?? [];
}

function ehOrfa(l: LinhaDoPedido): boolean {
  return l.provedor_pagamento_id === null && emAberto(l.estado);
}

/**
 * Em que epoca a ordem de uma tentativa pode ter nascido: da linha, com a
 * folga, ate a tentativa seguinte, menos a folga — porque a ordem DAQUELA
 * tambem pode parecer mais velha que ela. Vale porque a cobranca so abre
 * tentativa nova depois de a anterior ter resposta ou ter estourado o prazo e
 * a espera pela orfa, e o provedor cria a ordem dentro do prazo. Da mais
 * nova, a epoca vai ate agora.
 */
function janelaDaOrdem(
  todas: LinhaDoPedido[],
  linhaId: string
): { desdeMs: number; ateMs: number } {
  const posicao = todas.findIndex((l) => l.id === linhaId);
  const linha = todas[posicao];
  const seguinte = posicao > 0 ? todas[posicao - 1] : undefined;

  return {
    desdeMs: Date.parse(linha.criado_em) - FOLGA_DO_RELOGIO_MS,
    ateMs: seguinte
      ? Date.parse(seguinte.criado_em) - FOLGA_DO_RELOGIO_MS
      : Number.POSITIVE_INFINITY,
  };
}

/** Ordem sem data nao pode ser excluida de epoca nenhuma. */
function naJanela(ordem: OrdemEncontrada, janela: { desdeMs: number; ateMs: number }): boolean {
  if (ordem.criadaEmMs === null) return true;

  return ordem.criadaEmMs >= janela.desdeMs && ordem.criadaEmMs < janela.ateMs;
}

/**
 * A tentativa sem id em cuja epoca a ordem nasceu. As epocas nao se
 * sobrepoem, entao ha no maximo uma; ordem sem data fica com a mais nova.
 * Ordem nascida na epoca de uma tentativa que ja tem id, ou que morreu sem
 * id (recusada), nao e de orfa nenhuma.
 */
function donaDaOrdem(todas: LinhaDoPedido[], ordem: OrdemEncontrada): PagamentoOrfao | null {
  return todas.find((l) => ehOrfa(l) && naJanela(ordem, janelaDaOrdem(todas, l.id))) ?? null;
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
  const resultado = await aplica(admin, pagamento, resumo, eventoId, origem);

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
  eventoId: string,
  origem: OrigemDaConfirmacao
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
    await marcaPago(admin, pagamento.order_id);

    // Aprovou esta: as outras ainda abertas nao podem mais ser pagas. E se
    // outra ja estava aprovada, o cliente pagou duas vezes — o unico sinal
    // disso e este, porque o pedido ja estava `pago` e nada mais muda. (#6)
    const irmas = await encerraAbertas(admin, pagamento.order_id, origem, pagamento.id);
    if (irmas.aprovadas > 0) {
      await avisaPagamento('pagamento duplicado a estornar', pagamento.order_id);
    }
  }

  // Dinheiro que voltou pelo provedor — estorno pelo painel dele, chargeback
  // — e o pedido nao pode continuar com cara de pago: o dono produziria e
  // enviaria uma camiseta cujo valor ja nao esta com ele (#7).
  if (resumo.estado === 'estornado') {
    await marcaReembolsado(admin, pagamento.order_id);
  }

  return { tipo: 'aplicado', estado: resumo.estado };
}

/**
 * Move o pedido para `pago` — SE ele ainda espera pagamento (#11, #24).
 *
 * Zero linhas e o pedido ter saido de `aguardando_pagamento` por outro
 * caminho enquanto o dinheiro entrava. Se ja esta `pago`, outra via desta
 * mesma cobranca chegou antes (webhook e resposta sincrona correm), e nao ha
 * o que avisar. Qualquer outro status — o dono cancelou no meio — e dinheiro
 * capturado para um pedido que nao vai sair, e isso ninguem descobre sozinho.
 */
export async function marcaPago(admin: Admin, orderId: string): Promise<void> {
  const { data } = await admin
    .from('orders')
    .update({ status: 'pago' })
    .eq('id', orderId)
    .eq('status', 'aguardando_pagamento')
    .select('id');

  if (data?.length) return;

  const { data: pedido } = await admin
    .from('orders')
    .select('status')
    .eq('id', orderId)
    .maybeSingle();

  if (pedido?.status !== 'pago') {
    await avisaPagamento('pagamento aprovado em pedido nao pendente', orderId);
  }
}

/** De onde um estorno no provedor leva o pedido a `reembolsado` (#7). */
const REEMBOLSAVEIS = origensDe('reembolsado');

/**
 * Move o pedido para `reembolsado` quando o dinheiro voltou pelo provedor (#7).
 *
 * So alcanca pedido que ainda vive do pagamento — pago, em producao, enviado,
 * entregue: os mesmos de onde uma pessoa poderia reembolsar, lidos da mesma
 * tabela. Cancelado e reembolsado sao finais e ficam como estao; o `in` no
 * filtro E a regra. A trilha registra sem autor, como toda automacao.
 *
 * Quando alcanca, avisa: ninguem pediu esse estorno por aqui — foi o painel
 * do provedor ou um chargeback — e o dono precisa saber antes de produzir. O
 * estorno pedido pelo botao "Reembolsar" nao passa por este aviso: a
 * tentativa ja estava `estornado` quando a notificacao chega, `podeAvancar`
 * a ignora, e o pedido ja mudou pela mao de quem apertou.
 */
async function marcaReembolsado(admin: Admin, orderId: string): Promise<void> {
  const { data } = await admin
    .from('orders')
    .update({ status: 'reembolsado' })
    .eq('id', orderId)
    .in('status', REEMBOLSAVEIS)
    .select('id');

  if (data?.length) {
    await avisaPagamento('pagamento estornado no provedor: pedido reembolsado', orderId, 'warning');
  }
}

/**
 * Encerra as tentativas abertas de um pedido que tem id no provedor (#6, #21).
 *
 * Cancela la, e so entao marca `cancelado` aqui: marcar antes deixaria um QR
 * pagavel com cara de morto. Quando o provedor recusa o cancelamento e porque
 * a ordem ja e final la — paga, expirada — e a gente nao sabia: entao se
 * pergunta o estado real e se aplica, pelo mesmo caminho do webhook. Paga,
 * conta em `aprovadas`, e o pedido ja virou `pago` ao aplicar.
 *
 * Quando o provedor diz nao TER a ordem, e a consulta confirma, nao ha o que
 * cancelar nem o que esperar: a linha e encerrada aqui, com a marca disso.
 * Sem essa saida ela ficaria presa para sempre, e com ela o pedido — nem
 * pagavel, nem cancelavel. E o caso das cobrancas de teste (`ORDTST…`) quando
 * a credencial de producao entrar.
 *
 * Tentativa sem id (resposta que se perdeu) fica fora: nao ha o que cancelar
 * sem id, e marca-la `cancelado` a esconderia de `casaOrfa` — se a ordem dela
 * existe e for paga, e justamente ai que se quer o aviso.
 *
 * `exceto` e a tentativa que acabou de ser aprovada, quando quem chama e
 * `aplica`. As ja aprovadas entram na conta, porque a segunda aprovacao no
 * mesmo pedido e o sinal de pagamento em duplicidade.
 */
export async function encerraAbertas(
  admin: Admin,
  orderId: string,
  origem: OrigemDaConfirmacao,
  exceto?: string
): Promise<Encerramento> {
  let consulta = admin
    .from('pagamentos')
    .select('id, order_id, estado, provedor_pagamento_id, idempotency_key')
    .eq('order_id', orderId)
    .in('estado', [...EM_ABERTO, 'aprovado'])
    .not('provedor_pagamento_id', 'is', null);
  if (exceto) consulta = consulta.neq('id', exceto);

  const { data: linhas } = await consulta;

  const r: Encerramento = { encerradas: 0, aprovadas: 0, presas: 0 };

  // Uma por vez: sao poucas, e rajada no provedor e o que o limite deles pune.
  for (const l of linhas ?? []) {
    if (l.estado === 'aprovado') {
      r.aprovadas += 1;
      continue;
    }
    if (!l.provedor_pagamento_id) continue;

    const cancelamento = await cancelaOrdem(
      l.provedor_pagamento_id,
      chaveDerivada('cancela', l.idempotency_key)
    );

    if (cancelamento.ok) {
      // `in` em aberto no filtro: se um webhook aprovou no meio, nada e
      // sobrescrito — e a proxima volta ve `aprovado`.
      await admin
        .from('pagamentos')
        .update({
          estado: 'cancelado',
          provedor_status: cancelamento.status,
          provedor_status_detail: cancelamento.statusDetail,
        })
        .eq('id', l.id)
        .in('estado', [...EM_ABERTO]);
      r.encerradas += 1;
      continue;
    }

    if (cancelamento.motivo === 'invalido') {
      somaConfirmacao(r, await confirmaPeloProvedor(admin, l, l.provedor_pagamento_id, origem));
      continue;
    }

    if (cancelamento.motivo === 'inexistente') {
      // "Nao tenho essa ordem" so vale com a consulta dizendo o mesmo: um
      // 404 sozinho nao enterra uma cobranca. Se a consulta a acha, afinal,
      // vale o estado que ela disser.
      const localizacao = await localizaOrdem(l.provedor_pagamento_id);

      if (localizacao.ok && localizacao.ordem) {
        const confirmacao = await registraEAplica(
          admin,
          l,
          localizacao.ordem.resumo,
          l.provedor_pagamento_id,
          origem
        );
        somaConfirmacao(r, confirmacao);
        continue;
      }
      if (localizacao.ok) {
        await admin
          .from('pagamentos')
          .update({ estado: 'cancelado', provedor_status_detail: ORDEM_INEXISTENTE })
          .eq('id', l.id)
          .in('estado', [...EM_ABERTO]);
        r.encerradas += 1;
        continue;
      }
    }

    r.presas += 1;
  }

  return r;
}

/**
 * O que a confirmacao pelo provedor disse de uma tentativa que ele nao deixou
 * cancelar, na conta de quem chamou. Nao aplicou nada — ainda pendente la,
 * repetido, ou nao deu para perguntar — e continuar aberta.
 */
function somaConfirmacao(r: Encerramento, confirmacao: ResultadoDoWebhook): void {
  if (confirmacao.tipo !== 'aplicado') r.presas += 1;
  else if (confirmacao.estado === 'aprovado') r.aprovadas += 1;
  else if (emAberto(confirmacao.estado)) r.presas += 1;
  else r.encerradas += 1;
}

/**
 * Estorna no provedor as tentativas aprovadas de um pedido (#22).
 *
 * E o que o botao "Reembolsar" chama ANTES de mudar o status, e a ordem E a
 * protecao: estorna la, e so entao marca `estornado` aqui. Marcar antes — ou
 * so trocar o status, como o botao fazia — deixava o cliente lendo
 * "Reembolsado" com o dinheiro ainda na conta do dono. Quem chama so muda o
 * status quando nada ficou presa nem recusada.
 *
 * Normalmente ha uma aprovada; duas e o pagamento em duplicidade da #6, e as
 * duas voltam. A chave de idempotencia e derivada da chave da tentativa:
 * tentar de novo depois de uma falha no meio reusa a chave e nao estorna
 * duas vezes — e a que ja ficou `estornado` nem e tentada, so contada.
 *
 * Quando o provedor recusa (4xx), a ordem ja e outra la — estornada pelo
 * painel dele, por exemplo — e se pergunta o estado real: estornada, conta
 * como feita e a linha acompanha; ainda paga, e recusa de verdade, e o dono
 * resolve no painel. Ordem que o provedor diz nao ter tambem e recusa: nao ha
 * como devolver o que ele nao conhece.
 *
 * A linha e marcada direto, sem passar por `aplica`: o pedido vai mudar pela
 * mao de quem apertou, com autor e motivo na trilha, e a automacao nao pode
 * chegar antes e tomar o lugar dela.
 */
export async function estornaAprovadas(admin: Admin, orderId: string): Promise<Estorno> {
  const { data: linhas } = await admin
    .from('pagamentos')
    .select('id, order_id, estado, provedor_pagamento_id, idempotency_key')
    .eq('order_id', orderId)
    .in('estado', ['aprovado', 'estornado'])
    .not('provedor_pagamento_id', 'is', null);

  const r: Estorno = { estornadas: 0, jaEstornadas: 0, recusadas: 0, presas: 0 };

  // Uma por vez, como em `encerraAbertas`: rajada e o que o limite deles pune.
  for (const l of linhas ?? []) {
    if (l.estado === 'estornado') {
      r.jaEstornadas += 1;
      continue;
    }
    if (!l.provedor_pagamento_id) continue;

    const estorno = await reembolsaOrdem(
      l.provedor_pagamento_id,
      chaveDerivada('estorna', l.idempotency_key)
    );

    if (estorno.ok) {
      await marcaEstornada(admin, l.id, estorno);
      r.estornadas += 1;
      continue;
    }

    if (estorno.motivo === 'invalido') {
      const resumo = await consultaOrdem(l.provedor_pagamento_id);

      if (resumo?.estado === 'estornado') {
        await marcaEstornada(admin, l.id, resumo);
        r.estornadas += 1;
      } else if (resumo) {
        r.recusadas += 1;
      } else {
        r.presas += 1;
      }
      continue;
    }

    if (estorno.motivo === 'inexistente') r.recusadas += 1;
    else r.presas += 1;
  }

  return r;
}

/**
 * A tentativa vira `estornado`, com o status cru do provedor. `eq` em
 * `aprovado` no filtro: se a notificacao do estorno chegou no meio e ja
 * marcou, nada e sobrescrito.
 */
async function marcaEstornada(
  admin: Admin,
  pagamentoId: string,
  provedor: { status: string | null; statusDetail: string | null }
): Promise<void> {
  await admin
    .from('pagamentos')
    .update({
      estado: 'estornado',
      provedor_status: provedor.status,
      provedor_status_detail: provedor.statusDetail,
    })
    .eq('id', pagamentoId)
    .eq('estado', 'aprovado');
}

/**
 * Chave de idempotencia de uma operacao sobre a tentativa — cancelar,
 * estornar —, derivada da chave dela: estavel por tentativa (reenviar nao
 * duplica), distinta da chave da criacao (o provedor guarda a resposta por
 * chave, e reusar a da criacao devolveria a ordem criada com cara de
 * cancelada) e distinta entre as operacoes, pelo prefixo. No formato que o
 * provedor recomenda.
 */
function chaveDerivada(operacao: 'cancela' | 'estorna', chaveDaTentativa: string): string {
  const h = createHash('sha256').update(`${operacao}:${chaveDaTentativa}`).digest('hex');

  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/**
 * Aviso ao dono. Vai so a mensagem e o id do pedido, em tag: nada de e-mail,
 * valor ou corpo do provedor. `error` e dinheiro onde nao devia; `warning` e
 * dinheiro que voltou e o pedido acompanhou — precisa ser visto, nao acordar
 * ninguem. Funcao serverless congela ao responder; sem o `flush`, o evento
 * nao sai.
 */
async function avisaPagamento(
  mensagem: AvisoDePagamento,
  orderId: string,
  nivel: 'error' | 'warning' = 'error'
): Promise<void> {
  Sentry.captureMessage(mensagem, { level: nivel, tags: { order_id: orderId } });
  await Sentry.flush(2000);
}
