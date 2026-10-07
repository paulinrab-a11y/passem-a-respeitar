'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { ehAdmin } from '@/lib/admin';
import { ehStatusPedido, STATUS_PEDIDO, transicaoPermitida } from '@/lib/loja/status-do-pedido';
import { type Estorno, encerraAbertas, estornaAprovadas } from '@/lib/loja/webhook';
import { limita } from '@/lib/rate-limit';
import { clienteAdmin } from '@/lib/supabase/admin';
import { usuarioDaSessao } from '@/lib/supabase/servidor';
import type { EstadoAdmin } from './estado';

/**
 * Mudanca administrativa de status (Issue #43).
 *
 * A ordem e o desenho:
 *
 *   1. sessao        quem e, pelo servidor
 *   2. papel         e administrador? (lib/admin.ts — variavel de ambiente,
 *                    nunca o cliente)
 *   3. limite        60 por hora por administrador
 *   4. entrada       zod: id, destino do enum, motivo curto
 *   5. transicao     validada aqui, para a mensagem ser boa...
 *   6. cobranca      cancelar pedido que espera pagamento cancela ANTES a
 *                    cobranca aberta no provedor (#21). Senao o Pix continua
 *                    pagavel, o dinheiro entra, e o pedido diz "cancelado".
 *                    Reembolsar estorna ANTES no provedor (#22): se o estorno
 *                    nao sai, o status nao muda — senao o cliente le
 *                    "reembolsado" com o dinheiro ainda na conta do dono.
 *   7. banco         ...e validada DE NOVO em `muda_status_pedido`, porque
 *                    rota se esquece e banco nao. E o banco carimba o autor.
 *
 * Quem nao e administrador recebe a MESMA resposta de "pedido nao
 * encontrado": a tela nem existe para essa pessoa (404), e a acao nao conta
 * o contrario.
 */

const LIMITE = { maximo: 60, janelaMs: 60 * 60 * 1000 };

/**
 * Por que o reembolso nao pode seguir — ou `null` para seguir. Tres recusas,
 * tres saidas para o dono: tentar de novo, abrir o painel do provedor, ou
 * entender que este pedido nao tem cobranca que o site conheca.
 */
function recadoDoEstorno(e: Estorno): string | null {
  if (e.presas > 0) {
    return 'Não consegui estornar no Mercado Pago agora. O status não mudou. Tente de novo.';
  }
  if (e.recusadas > 0) {
    return 'O Mercado Pago não aceitou o estorno. O status não mudou. Confira a cobrança no painel dele.';
  }
  if (e.estornadas === 0 && e.jaEstornadas === 0) {
    return 'Não achei cobrança aprovada para estornar. O status não mudou.';
  }
  return null;
}

const esquema = z.object({
  pedido: z.string().uuid(),
  para: z.enum(STATUS_PEDIDO),
  motivo: z.string().trim().max(300).optional().or(z.literal('')),
});

const NAO_ENCONTRADO: EstadoAdmin = {
  recado: { tom: 'erro', texto: 'Pedido não encontrado.' },
  pedido: null,
};

export async function mudarStatus(_anterior: EstadoAdmin, form: FormData): Promise<EstadoAdmin> {
  const usuario = await usuarioDaSessao();
  if (!usuario) return NAO_ENCONTRADO;

  if (!ehAdmin({ email: usuario.email, emailVerificado: Boolean(usuario.email_confirmed_at) })) {
    return NAO_ENCONTRADO;
  }

  const cota = await limita(`admin-status:${usuario.id}`, LIMITE.maximo, LIMITE.janelaMs);
  if (!cota.permitido) {
    return {
      recado: { tom: 'erro', texto: 'Muitas mudanças em pouco tempo. Espere um pouco.' },
      pedido: null,
    };
  }

  const dados = esquema.safeParse({
    pedido: form.get('pedido'),
    para: form.get('para'),
    motivo: form.get('motivo') ?? '',
  });
  if (!dados.success) {
    return { recado: { tom: 'erro', texto: 'Confira os dados.' }, pedido: null };
  }

  const { pedido, para } = dados.data;
  const motivo = dados.data.motivo || null;

  const admin = clienteAdmin();

  const { data: atual } = await admin
    .from('orders')
    .select('status')
    .eq('id', pedido)
    .maybeSingle();

  if (!atual || !ehStatusPedido(atual.status)) return { ...NAO_ENCONTRADO, pedido };

  if (!transicaoPermitida(atual.status, para)) {
    return {
      recado: { tom: 'erro', texto: `Não dá para ir de "${atual.status}" para "${para}".` },
      pedido,
    };
  }

  // Cobranca aberta no provedor morre antes do pedido. Se nao der para
  // cancelar, o pedido nao e cancelado: um Pix vivo num pedido cancelado e
  // dinheiro entrando sem ninguem saber. E se ela ja estava paga, o pedido
  // ja e outro — nao e o que a pessoa estava olhando.
  if (atual.status === 'aguardando_pagamento' && para === 'cancelado') {
    const abertas = await encerraAbertas(admin, pedido, 'admin');

    if (abertas.aprovadas > 0) {
      return {
        recado: { tom: 'erro', texto: 'Este pedido tem um pagamento aprovado. Recarregue.' },
        pedido,
      };
    }
    if (abertas.presas > 0) {
      return {
        recado: {
          tom: 'erro',
          texto: 'Não consegui cancelar a cobrança em aberto no provedor. Tente de novo.',
        },
        pedido,
      };
    }
  }

  // Reembolsar devolve o dinheiro ANTES de mudar o status (#22). Antes o
  // botao so trocava o rotulo: o cliente lia "Reembolsado" e o valor
  // continuava na conta. Se o provedor nao estornar, o pedido nao muda — e o
  // recado diz por que, para o dono resolver no painel dele.
  let estornadas = 0;
  if (para === 'reembolsado') {
    const estorno = await estornaAprovadas(admin, pedido);
    const recusa = recadoDoEstorno(estorno);
    if (recusa) return { recado: { tom: 'erro', texto: recusa }, pedido };
    estornadas = estorno.estornadas;
  }

  // O autor e o id da sessao, lido no servidor. O banco valida a transicao
  // de novo e grava autor e motivo na trilha.
  const { error } = await admin.rpc('muda_status_pedido', {
    p_order_id: pedido,
    p_para: para,
    p_autor: usuario.id,
    p_motivo: motivo,
  });

  if (error) {
    // Transicao recusada pelo banco (P0001) e a unica esperada aqui: outra
    // pessoa mudou o status entre a leitura e a escrita.
    console.warn('[admin] status recusado:', error.code, pedido);
    return {
      recado: { tom: 'erro', texto: 'O pedido mudou enquanto você olhava. Recarregue.' },
      pedido,
    };
  }

  // Log de auditoria: quem, qual pedido, de onde para onde. Ids, nunca nome
  // ou endereco. A trilha completa, com motivo, esta em order_status_history.
  console.info('[admin] status', usuario.id, pedido, `${atual.status} -> ${para}`);
  if (estornadas > 0) console.info('[admin] estorno', usuario.id, pedido, estornadas);

  revalidatePath('/conta/admin/pedidos');
  revalidatePath(`/conta/pedidos/${pedido}`);

  return {
    recado: {
      tom: 'ok',
      texto:
        estornadas > 0 ? 'Estornado no Mercado Pago. Status atualizado.' : 'Status atualizado.',
    },
    pedido,
  };
}
