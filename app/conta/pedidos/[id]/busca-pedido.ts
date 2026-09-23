import 'server-only';

import { mapeiaDetalhe, type PedidoDetalhado } from '@/lib/conta/pedidos';
import { clienteServidor, usuarioDaSessao } from '@/lib/supabase/servidor';

/**
 * Tres respostas, e a forma delas e o desenho de seguranca da tela.
 *
 * `nao-achei` cobre "nao existe" E "e de outra pessoa" no mesmo valor, porque a
 * consulta tambem nao distingue os dois. E isso que faz o 404 da #42 ser solido
 * em vez de disciplinado: nao existe um galho "achei, mas nao e seu" para
 * alguem escrever errado um dia, nem um `if` de autorizacao para esquecer.
 *
 * `sem-sessao` e separado porque termina em outra tela — login, nao 404.
 */
export type Resultado =
  | { tipo: 'sem-sessao' }
  | { tipo: 'nao-achei' }
  | { tipo: 'ok'; pedido: PedidoDetalhado };

/**
 * Busca o pedido do usuario da sessao.
 *
 * O pedido do vizinho e invisivel para esta consulta duas vezes:
 *
 *   1. `eq('user_id', ...)` — o filtro explicito, que continuaria de pe mesmo
 *      se um dia isto rodasse com um client de service_role
 *   2. RLS `orders_le_os_proprios`, no banco
 *
 * Um `getUser()` so no caminho inteiro: e o mesmo que a consulta ja precisou
 * fazer para saber por quem filtrar.
 */
export async function meuPedido(id: string): Promise<Resultado> {
  const usuario = await usuarioDaSessao();
  if (!usuario) return { tipo: 'sem-sessao' };

  const supabase = await clienteServidor();

  const { data, error } = await supabase
    .from('orders')
    // Uma consulta so, com os dois filhos embutidos. Sem N+1: itens e trilha
    // vem na mesma ida. Colunas nomeadas — `autor` e `motivo` da trilha ficam
    // no banco, ver o comentario de `mapeiaDetalhe`.
    .select(
      'id, numero, criado_em, status, total_centavos, order_items(id, nome, tamanho, quantidade, preco_unitario_centavos), order_status_history(para, criado_em)'
    )
    .eq('id', id)
    .eq('user_id', usuario.id)
    .order('nome', { referencedTable: 'order_items', ascending: true })
    .order('tamanho', { referencedTable: 'order_items', ascending: true })
    .order('criado_em', { referencedTable: 'order_status_history', ascending: true })
    // `maybeSingle` e nao `single`: nao achar e resposta esperada aqui, nao
    // erro. Com `single`, "pedido de outra pessoa" viraria excecao — e excecao
    // tem cara diferente de 404 na tela, que e justamente o que a #42 nao quer.
    .maybeSingle();

  // Erro de consulta cai no mesmo lugar. Nao e para esconder problema nosso: e
  // que a alternativa seria uma tela de erro que aparece para pedido alheio e
  // nao aparece para pedido inexistente, e essa diferenca e a resposta.
  if (error || !data) return { tipo: 'nao-achei' };

  return { tipo: 'ok', pedido: mapeiaDetalhe(data) };
}
