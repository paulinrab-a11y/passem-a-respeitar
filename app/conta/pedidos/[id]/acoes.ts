'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { z } from 'zod';
import { MENSAGEM_MAX, TIPOS_POS_VENDA } from '@/lib/conta/pos-venda';
import { ipDoRequest, limita } from '@/lib/rate-limit';
import { clienteServidor, usuarioDaSessao } from '@/lib/supabase/servidor';
import type { EstadoPosVenda } from './estado';

/**
 * Pedir cancelamento, desistir, trocar ou avisar de defeito pelo site (#379).
 *
 *   1. sessao      quem e, pelo servidor
 *   2. limite      10 por hora por conta e 30 por IP: e um formulario de
 *                  conta, mas cada envio vira trabalho para o dono
 *   3. entrada     zod: id do pedido, tipo do enum, mensagem curta
 *   4. banco       insert com o client da SESSAO, nunca o de servico: a RLS
 *                  confere que o pedido e da pessoa, que o status permite e
 *                  que o prazo nao venceu (`pos_venda_cabe`). A acao nao
 *                  repete essa conta — se repetisse, seriam duas regras para
 *                  divergir. O dono da linha vem do `default auth.uid()`.
 *
 * O que volta e o protocolo e a hora, para a tela confirmar o recebimento na
 * hora (Decreto 7.962/2013, art. 5º, § 4º). E-mail de confirmacao ainda nao
 * existe no site (#55).
 */

const POR_CONTA = { maximo: 10, janelaMs: 60 * 60 * 1000 };
const POR_IP = { maximo: 30, janelaMs: 60 * 60 * 1000 };

const esquema = z.object({
  pedido: z.string().uuid(),
  tipo: z.enum(TIPOS_POS_VENDA),
  mensagem: z.string().trim().max(MENSAGEM_MAX).optional().or(z.literal('')),
});

const erro = (texto: string): EstadoPosVenda => ({ erro: texto, recebido: null });

export async function pedirPosVenda(
  _anterior: EstadoPosVenda,
  form: FormData
): Promise<EstadoPosVenda> {
  const usuario = await usuarioDaSessao();
  if (!usuario) return erro('Sua sessão expirou. Entre de novo.');

  const ip = ipDoRequest(await headers());
  const [cotaConta, cotaIp] = await Promise.all([
    limita(`pos-venda:${usuario.id}`, POR_CONTA.maximo, POR_CONTA.janelaMs),
    limita(`pos-venda:ip:${ip}`, POR_IP.maximo, POR_IP.janelaMs),
  ]);
  if (!cotaConta.permitido || !cotaIp.permitido) {
    return erro('Muitos pedidos em pouco tempo. Espere um pouco ou escreva para a loja.');
  }

  const dados = esquema.safeParse({
    pedido: form.get('pedido'),
    tipo: form.get('tipo'),
    mensagem: form.get('mensagem') ?? '',
  });
  if (!dados.success) {
    const longa = dados.error.issues.some((i) => i.path[0] === 'mensagem');
    return erro(
      longa
        ? `Use até ${MENSAGEM_MAX} caracteres na mensagem.`
        : 'Recarregue a página e tente de novo.'
    );
  }

  const { pedido, tipo } = dados.data;
  const supabase = await clienteServidor();

  const { data, error } = await supabase
    .from('solicitacoes_pos_venda')
    // Tres colunas, as unicas com GRANT de insert. O resto vem do banco.
    .insert({ order_id: pedido, tipo, mensagem: dados.data.mensagem || null })
    .select('protocolo, criado_em')
    .single();

  if (error?.code === '23505') {
    // Ja ha uma aberta deste tipo: clique duplo, ou outra aba. A resposta e
    // a mesma confirmacao, com o protocolo que ja existe.
    const { data: aberta } = await supabase
      .from('solicitacoes_pos_venda')
      .select('protocolo, criado_em')
      .eq('order_id', pedido)
      .eq('tipo', tipo)
      .is('resolvida_em', null)
      .maybeSingle();
    if (aberta) {
      return {
        erro: null,
        recebido: {
          tipo,
          protocolo: aberta.protocolo,
          criadoEm: aberta.criado_em,
          jaExistia: true,
        },
      };
    }
  }

  if (error || !data) {
    // 42501: a policy recusou — pedido de outra pessoa, status que mudou
    // (o dono acabou de enviar), prazo que venceu enquanto a tela estava
    // aberta. A mesma resposta para todos: a tela recarregada mostra o que
    // cabe agora, e o e-mail continua valendo.
    console.warn('[pos-venda] recusado:', error?.code, pedido);
    return erro(
      error?.code === '42501'
        ? 'Este pedido não aceita mais esse pedido pelo site. Recarregue a página para ver o que cabe agora, ou escreva para a loja.'
        : 'Não deu para registrar agora. Tente de novo em instantes ou escreva para a loja.'
    );
  }

  // Ids, nunca a mensagem: ela e da pessoa e fica no banco.
  console.info('[pos-venda] recebido', usuario.id, pedido, tipo);

  revalidatePath(`/conta/pedidos/${pedido}`);
  revalidatePath('/conta/admin/pedidos');
  revalidatePath(`/conta/admin/pedidos/${pedido}`);

  return {
    erro: null,
    recebido: { tipo, protocolo: data.protocolo, criadoEm: data.criado_em, jaExistia: false },
  };
}
