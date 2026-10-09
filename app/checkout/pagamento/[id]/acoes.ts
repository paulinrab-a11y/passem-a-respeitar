'use server';

import { z } from 'zod';
import { conciliaPedido } from '@/lib/loja/conciliacao';
import { limita } from '@/lib/rate-limit';
import { clienteServidor, usuarioDaSessao } from '@/lib/supabase/servidor';

/**
 * A tela do Pix pergunta se o pedido ainda espera pagamento (#250).
 *
 * O Pix e pago fora daqui, no app do banco, e a confirmacao chega ao servidor
 * pelo webhook. Nada empurra isso para a aba aberta: quem pagou voltava e via
 * "Aguardando pagamento" para sempre. Esta acao e o que a tela usa para
 * perguntar — sozinha, de tempos em tempos, e quando a pessoa toca em
 * "Conferir pagamento".
 *
 * Por que acao e nao `router.refresh()`: o refresh rerenderiza a pagina de
 * pagamento inteira, e qualquer tropeco no caminho (sessao vencida, consulta
 * que falhou) troca o QR por login ou 404 com a pessoa no meio do pagamento.
 * Aqui a resposta e uma palavra, e a tela decide; o QR nunca sai por erro.
 *
 * A resposta e so o estado. Nada do pedido sai daqui: a tela ja tem o que
 * precisa, e quem quer o detalhe abre o pedido, que le pelo caminho normal.
 */
export type Conferencia = 'aguardando' | 'mudou' | 'sem-sessao' | 'limite' | 'falhou';

/**
 * Vinte por minuto por pessoa. A tela confere a cada 10 s (seis por minuto)
 * e o botao soma alguns; duas abas abertas ainda cabem. O alvo e script em
 * laco, nao quem toca no botao duas vezes.
 */
const LIMITE = { maximo: 20, janelaMs: 60 * 1000 };

const esquema = z.string().uuid();

export async function conferePagamento(pedido: unknown): Promise<Conferencia> {
  // O id vem do navegador. Torto nem chega ao banco: viraria erro do
  // PostgREST, e erro do banco nao e resposta que a tela saiba usar.
  const id = esquema.safeParse(pedido);
  if (!id.success) return 'falhou';

  // Quase nunca sai daqui: sem sessao, o proxy redireciona o POST da acao
  // para /entrar antes de ela rodar, e quem percebe e a tela (ver `pergunta`
  // em Pix.tsx). Fica pela sessao que cai entre o proxy e esta linha, e
  // porque a acao nao confia no que veio antes dela.
  const usuario = await usuarioDaSessao();
  if (!usuario) return 'sem-sessao';

  const cota = await limita(`confere-pagamento:${usuario.id}`, LIMITE.maximo, LIMITE.janelaMs);
  if (!cota.permitido) return 'limite';

  const antes = await aindaAguarda(id.data, usuario.id);
  if (antes === null) return 'falhou';
  if (!antes) return 'mudou';

  // O webhook pode atrasar ou se perder. A mesma conciliacao da tela do pedido
  // (#114) pergunta ao Mercado Pago, e ela mesma se limita a uma ida por
  // minuto por pedido: conferir a cada 10 s nao vira rajada no provedor. So
  // chega aqui pedido que a consulta acima, filtrada pelo dono, achou.
  if (!(await conciliaPedido(id.data))) return 'aguardando';

  // A conciliacao so diz "mudou alguma tentativa". Quem diz se o pedido saiu
  // da espera e o pedido, lido de novo pelo mesmo caminho. Releitura que
  // falhou e falha, e nao "aguardando": a conciliacao pode ter achado o
  // pagamento, e "ainda nao apareceu" seria afirmar o que ninguem leu.
  const depois = await aindaAguarda(id.data, usuario.id);
  if (depois === null) return 'falhou';
  return depois ? 'aguardando' : 'mudou';
}

/**
 * `true` se o pedido espera pagamento; `false` se ja saiu da espera (pago,
 * cancelado, qualquer outro); `null` se nao achou — inexistente, de outra
 * pessoa ou consulta que falhou, os tres iguais, como em `meuPedido`.
 *
 * So a coluna de status: a tela nao precisa de mais nada, e o pedido inteiro
 * (itens, endereco) nao tem por que sair do banco a cada 10 s.
 */
async function aindaAguarda(id: string, dono: string): Promise<boolean | null> {
  const supabase = await clienteServidor();

  // Dono duas vezes, como em `meuPedido`: o filtro explicito e a RLS
  // `orders_le_os_proprios`.
  const { data, error } = await supabase
    .from('orders')
    .select('status')
    .eq('id', id)
    .eq('user_id', dono)
    .maybeSingle();

  if (error || !data) return null;
  return data.status === 'aguardando_pagamento';
}
