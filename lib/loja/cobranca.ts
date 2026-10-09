import 'server-only';

/**
 * Cobranca de um pedido (Issue #110).
 *
 * A ordem dos passos e o desenho, e nao detalhe de implementacao:
 *
 *   1. sessao          quem e, pelo servidor
 *   2. pedido          dele, e ainda aguardando pagamento
 *   3. linha em `pagamentos`   ANTES de falar com o provedor
 *   4. cobranca        com o valor do BANCO e a chave da linha
 *   5. atualiza a linha com o que voltou
 *
 * O passo 3 vir antes do 4 e o que salva o caso feio: se a resposta se perder
 * no meio — rede, timeout, deploy —, a tentativa ja esta registrada com a
 * `idempotency_key` dela. Reenviar reusa a chave e o provedor devolve a MESMA
 * cobranca em vez de criar outra. Se a linha nascesse depois, uma cobranca
 * real existiria no provedor sem nenhum registro nosso.
 *
 * E entre o 2 e o 3, uma regra: UMA cobranca viva por pedido. A tentativa
 * anterior que ficou sem resposta e reencontrada no provedor (#5), e a que
 * ainda esta aberta la — Pix esperando — e cancelada antes de a nova nascer
 * (#6). Trocar Pix por cartao nao pode deixar um QR pagavel para tras.
 */

import { z } from 'zod';
import { clienteAdmin } from '@/lib/supabase/admin';
import { usuarioDaSessao } from '@/lib/supabase/servidor';
import { criaOrdem, type MetodoDePagamento } from './orders-api';
import { vendaLiberada } from './vendedor';
import { casaOrfa, encerraAbertas, marcaPago, orfasDoPedido } from './webhook';

/**
 * O que o navegador pode mandar.
 *
 * Repare no que nao esta aqui: valor, total, moeda, status. O total vem de
 * `orders.total_centavos`. Um `amount` no corpo nao e recusado — e descartado
 * pelo schema antes de virar objeto. (#19)
 *
 * `token` e o do Brick, que representa o cartao sem ser o cartao. PAN e CVV
 * nunca chegam aqui: eles ficaram nos iframes de `secure-fields.mercadopago.com`.
 */
const esquemaCobranca = z.object({
  pedido: z.string().uuid(),
  // Vem do Brick: 'pix', 'master', 'visa', 'elo'...
  payment_method_id: z
    .string()
    .trim()
    .regex(/^[a-z0-9_]{2,40}$/),
  token: z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9]{8,128}$/)
    .optional(),
  installments: z.number().int().min(1).max(24).optional(),
  payer: z
    .object({
      identification: z
        .object({
          type: z.enum(['CPF', 'CNPJ']),
          number: z
            .string()
            .trim()
            .regex(/^\d{11,14}$/),
        })
        .optional(),
    })
    .optional(),
});

export type MotivoDaCobranca =
  | 'entrada-invalida'
  | 'sem-sessao'
  | 'pedido-nao-encontrado'
  | 'pedido-ja-pago'
  | 'tentativas-demais'
  | 'recusado'
  | 'indisponivel'
  /**
   * Problema nosso, nao da pessoa: o provedor recusou a nossa credencial
   * (#23), ou, em producao, faltam os dados de quem vende (#276).
   */
  | 'configuracao'
  /** A tentativa anterior ficou sem resposta e ainda nao se sabe o que houve com ela. */
  | 'pagamento-em-processamento'
  /** Ha uma cobranca aberta no provedor que nao deu para cancelar antes de abrir outra. */
  | 'pagamento-pendente';

export type ResultadoDaCobranca =
  | {
      ok: true;
      estado: string;
      /** So em Pix. Vem do provedor. */
      pix?: { copiaECola: string; qrBase64: string | null; expiraEm: string | null };
    }
  | { ok: false; motivo: MotivoDaCobranca };

/** Vinte por pedido, que e o teto do check de `pagamentos.tentativa`. */
const MAX_TENTATIVAS = 20;

/**
 * Por quanto tempo uma tentativa sem resposta ainda e "em processamento"
 * quando o provedor diz nao ter ordem para ela. A busca pode nao enxergar na
 * hora o que acabou de nascer la; passado isso, se nao apareceu, nao existe —
 * e a pessoa pode tentar de novo.
 */
const ESPERA_PELA_ORFA_MS = 60 * 1000;

export async function cobra(bruto: unknown): Promise<ResultadoDaCobranca> {
  const entrada = esquemaCobranca.safeParse(bruto);
  if (!entrada.success) return { ok: false, motivo: 'entrada-invalida' };

  const usuario = await usuarioDaSessao();
  if (!usuario) return { ok: false, motivo: 'sem-sessao' };

  // Em producao, sem quem vende identificado nao se cobra (#276). Antes de
  // tocar no banco e no provedor: nenhuma tentativa nasce, nenhuma ordem
  // existe la. Para a pessoa e o mesmo "indisponivel" da credencial
  // recusada — problema nosso, nao do cartao dela.
  if (!vendaLiberada()) return { ok: false, motivo: 'configuracao' };

  const admin = clienteAdmin();

  // Filtro por dono NA CONSULTA, nao comparacao depois. Pedido de outra pessoa
  // simplesmente nao volta — e por isso "nao e seu" e "nao existe" dao a mesma
  // resposta, sem um `if` para alguem escrever errado.
  const { data: pedido } = await admin
    .from('orders')
    .select('id, total_centavos, status')
    .eq('id', entrada.data.pedido)
    .eq('user_id', usuario.id)
    .maybeSingle();

  if (!pedido) return { ok: false, motivo: 'pedido-nao-encontrado' };

  // Pedido que ja saiu de "aguardando pagamento" nao se cobra de novo. Cobrar
  // duas vezes o mesmo pedido e o erro que ninguem perdoa.
  if (pedido.status !== 'aguardando_pagamento') {
    return { ok: false, motivo: 'pedido-ja-pago' };
  }

  // Tentativa anterior sem resposta (timeout, deploy no meio) pode ter virado
  // cobranca de verdade do outro lado. Abrir outra agora e o caminho mais
  // curto para cobrar o cartao duas vezes — entao primeiro se pergunta ao
  // provedor o que houve com ela. Com TODAS elas, da mais nova para a mais
  // velha: a mais nova pode nunca ter chegado la enquanto a anterior virou
  // cobranca de verdade. (#5, #14)
  for (const orfa of await orfasDoPedido(admin, pedido.id)) {
    const r = await casaOrfa(admin, orfa, 'cobranca');

    // A cobranca anterior aconteceu: nao se abre outra. O pedido conta a
    // historia — aprovado ja virou `pago` ao aplicar.
    if (r.tipo === 'aplicado' && r.estado === 'aprovado') {
      return { ok: true, estado: 'aprovado' };
    }

    // Nao deu para perguntar, ou alguem esta vinculando agora mesmo: esperar
    // e a unica resposta segura.
    if (r.tipo === 'tente-de-novo' || (r.tipo === 'ignorado' && r.motivo === 'ja-vinculado')) {
      return { ok: false, motivo: 'pagamento-em-processamento' };
    }

    // O provedor nao tem ordem para ela. Recem-criada, pode so nao ter
    // aparecido ainda na busca; passada a espera, nunca chegou la.
    if (
      r.tipo === 'ignorado' &&
      r.motivo === 'sem-ordem-no-provedor' &&
      Date.parse(orfa.criado_em) > Date.now() - ESPERA_PELA_ORFA_MS
    ) {
      return { ok: false, motivo: 'pagamento-em-processamento' };
    }

    // Recusada ou cancelada do outro lado, ou nunca chegou la: esta morreu, e
    // se olha a anterior. Pendente la, ela acabou de ganhar id — e e encerrada
    // logo abaixo como qualquer tentativa aberta.
  }

  // Uma cobranca viva por pedido (#6). O Pix que ficou esperando e cancelado
  // no provedor antes de a nova nascer; se nao der para cancelar, nao se abre
  // outra. Quando o provedor nao deixa porque a anterior ja foi paga, o
  // pedido virou `pago` ao aplicar, e e isso que se responde.
  const abertas = await encerraAbertas(admin, pedido.id, 'cobranca');
  if (abertas.aprovadas > 0) return { ok: true, estado: 'aprovado' };
  if (abertas.presas > 0) return { ok: false, motivo: 'pagamento-pendente' };

  const { data: anteriores } = await admin
    .from('pagamentos')
    .select('tentativa')
    .eq('order_id', pedido.id)
    .order('tentativa', { ascending: false })
    .limit(1);

  const tentativa = (anteriores?.[0]?.tentativa ?? 0) + 1;
  if (tentativa > MAX_TENTATIVAS) return { ok: false, motivo: 'tentativas-demais' };

  const ehPix = entrada.data.payment_method_id === 'pix';
  const metodo: MetodoDePagamento = ehPix
    ? { tipo: 'pix' }
    : {
        tipo: 'cartao',
        bandeira: entrada.data.payment_method_id,
        token: entrada.data.token ?? '',
        parcelas: entrada.data.installments ?? 1,
      };

  if (metodo.tipo === 'cartao' && !metodo.token) {
    return { ok: false, motivo: 'entrada-invalida' };
  }

  // A linha nasce aqui, antes da chamada. O `select` devolve a chave que vai
  // no header de idempotencia.
  const { data: linha, error: erroLinha } = await admin
    .from('pagamentos')
    .insert({
      order_id: pedido.id,
      tentativa,
      metodo: ehPix ? 'pix' : 'credit_card',
      valor_centavos: pedido.total_centavos,
    })
    .select('id, idempotency_key')
    .single();

  // Conflito no indice unico (order_id, tentativa) = dois cliques ao mesmo
  // tempo. A recusa E a protecao contra cobranca duplicada.
  if (erroLinha || !linha) return { ok: false, motivo: 'indisponivel' };

  const resposta = await criaOrdem({
    pedidoId: pedido.id,
    // Do BANCO. Nao ha caminho por onde um numero do navegador chegue aqui.
    totalCentavos: pedido.total_centavos,
    email: usuario.email ?? '',
    documento: entrada.data.payer?.identification
      ? {
          tipo: entrada.data.payer.identification.type,
          numero: entrada.data.payer.identification.number,
        }
      : null,
    metodo,
    idempotencia: linha.idempotency_key,
  });

  if (!resposta.ok) {
    // Sem resposta nao se sabe se a ordem nasceu la: a linha fica `criado`
    // e a proxima cobranca pergunta (#5). Com resposta, a tentativa morreu —
    // inclusive com a credencial recusada, que nao cria ordem nenhuma; deixa-
    // la `criado` faria a proxima cobranca procurar uma orfa que nao existe.
    // O que o provedor disse dela fica na linha: o status_detail do cartao,
    // ou o code do erro. (#23)
    const semResposta = resposta.motivo === 'indisponivel';

    await admin
      .from('pagamentos')
      .update({
        estado: semResposta ? 'criado' : 'recusado',
        provedor_status: resposta.resumo?.status ?? null,
        provedor_status_detail: resposta.resumo?.statusDetail ?? null,
      })
      .eq('id', linha.id);

    if (semResposta) return { ok: false, motivo: 'indisponivel' };
    if (resposta.motivo === 'configuracao') return { ok: false, motivo: 'configuracao' };

    // Cartao recusado NAO mexe em `orders.status`: o pedido continua
    // aguardando pagamento e cabe outra tentativa. E para isso que
    // `pagamentos.tentativa` existe.
    return { ok: false, motivo: 'recusado' };
  }

  await admin
    .from('pagamentos')
    .update({
      provedor_pagamento_id: resposta.provedorId || null,
      estado: resposta.resumo.estado,
      provedor_status: resposta.resumo.status,
      provedor_status_detail: resposta.resumo.statusDetail,
    })
    .eq('id', linha.id);

  // 2xx nao e aprovacao: cartao sem limite tambem volta assim, com
  // `status: failed`. Para quem paga e recusa igual — o formulario fica e
  // cabe outro cartao; a linha acima ja guarda o status_detail. Mandar a
  // pessoa para o pedido aqui era deixa-la achar que pagou. (#20)
  if (resposta.resumo.estado === 'recusado' || resposta.resumo.estado === 'cancelado') {
    return { ok: false, motivo: 'recusado' };
  }

  // Aprovado na resposta sincrona e confirmacao server-to-server do provedor,
  // nao afirmacao do navegador — entao vale. O webhook da #45 confirma depois,
  // e a trilha de status e escrita sozinha pelo trigger da #18. Mas so anda
  // se o pedido ainda espera: cancelado no meio, vira aviso, nao `pago`.
  // (#11, #24)
  if (resposta.resumo.estado === 'aprovado') {
    await marcaPago(admin, pedido.id);
  }

  return {
    ok: true,
    estado: resposta.resumo.estado,
    ...(resposta.pix ? { pix: resposta.pix } : {}),
  };
}
