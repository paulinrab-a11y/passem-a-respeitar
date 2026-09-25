'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { ehAdmin } from '@/lib/admin';
import { ehStatusPedido, STATUS_PEDIDO, transicaoPermitida } from '@/lib/loja/status-do-pedido';
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
 *   6. banco         ...e validada DE NOVO em `muda_status_pedido`, porque
 *                    rota se esquece e banco nao. E o banco carimba o autor.
 *
 * Quem nao e administrador recebe a MESMA resposta de "pedido nao
 * encontrado": a tela nem existe para essa pessoa (404), e a acao nao conta
 * o contrario.
 */

const LIMITE = { maximo: 60, janelaMs: 60 * 60 * 1000 };

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

  revalidatePath('/conta/admin/pedidos');
  revalidatePath(`/conta/pedidos/${pedido}`);

  return { recado: { tom: 'ok', texto: 'Status atualizado.' }, pedido };
}
