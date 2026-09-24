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
 */

import { z } from 'zod';
import { clienteAdmin } from '@/lib/supabase/admin';
import { usuarioDaSessao } from '@/lib/supabase/servidor';
import { montaEstado } from './estado-do-pagamento';
import { criaOrdem, type MetodoDePagamento } from './orders-api';

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
  | 'indisponivel';

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

export async function cobra(bruto: unknown): Promise<ResultadoDaCobranca> {
  const entrada = esquemaCobranca.safeParse(bruto);
  if (!entrada.success) return { ok: false, motivo: 'entrada-invalida' };

  const usuario = await usuarioDaSessao();
  if (!usuario) return { ok: false, motivo: 'sem-sessao' };

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
    const resumo = resposta.resumo ?? montaEstado(resposta.motivo === 'recusado' ? 'failed' : null);

    await admin
      .from('pagamentos')
      .update({
        estado: resposta.motivo === 'indisponivel' ? 'criado' : 'recusado',
        provedor_status: resumo.status,
        provedor_status_detail: resumo.statusDetail,
      })
      .eq('id', linha.id);

    // Cartao recusado NAO mexe em `orders.status`: o pedido continua
    // aguardando pagamento e cabe outra tentativa. E para isso que
    // `pagamentos.tentativa` existe.
    return { ok: false, motivo: resposta.motivo === 'indisponivel' ? 'indisponivel' : 'recusado' };
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

  // Aprovado na resposta sincrona e confirmacao server-to-server do provedor,
  // nao afirmacao do navegador — entao vale. O webhook da #45 confirma depois,
  // e a trilha de status e escrita sozinha pelo trigger da #18.
  if (resposta.resumo.estado === 'aprovado') {
    await admin.from('orders').update({ status: 'pago' }).eq('id', pedido.id);
  }

  return {
    ok: true,
    estado: resposta.resumo.estado,
    ...(resposta.pix ? { pix: resposta.pix } : {}),
  };
}
