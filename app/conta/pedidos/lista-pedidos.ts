import 'server-only';

// Nome com hifen pelo mesmo motivo de lista-sessoes.ts: deixar espaco para um
// `Pedidos.tsx` ao lado sem colisao de maiuscula/minuscula no Windows.

import { mapeiaPedidos, type Pedido, POR_PAGINA } from '@/lib/conta/pedidos';
import { clienteServidor, usuarioDaSessao } from '@/lib/supabase/servidor';

export type PaginaDePedidos = { pedidos: Pedido[]; temMais: boolean };

/**
 * Uma pagina dos pedidos do usuario da sessao.
 *
 * `null` e lista vazia sao coisas diferentes, e por isso os dois existem:
 * `null` e "nao ha sessao" e termina em redirect para o login; `[]` e "esta
 * pessoa ainda nao comprou" e termina no estado vazio. Se os dois fossem `[]`,
 * quem perdeu a sessao veria "nenhum pedido ainda" — uma tela que mente.
 */
export async function meusPedidos(pagina: number): Promise<PaginaDePedidos | null> {
  const usuario = await usuarioDaSessao();
  if (!usuario) return null;

  const inicio = (pagina - 1) * POR_PAGINA;

  const supabase = await clienteServidor();

  const { data, error } = await supabase
    .from('orders')
    // Colunas nomeadas, nunca `select *`. O que nao esta escrito aqui nao
    // chega nem a sair do banco. (#20)
    .select(
      'numero, criado_em, status, total_centavos, order_items(id, nome, tamanho, quantidade, preco_unitario_centavos)'
    )
    // A RLS ja garantiria isto sozinha. O filtro explicito e a primeira
    // barreira: se um dia esta funcao rodar com um client de service_role, o
    // `eq` continua de pe. (Mesmo raciocinio de perfilDaSessao.)
    .eq('user_id', usuario.id)
    .order('criado_em', { ascending: false })
    // Desempate. Sem ele, dois pedidos com o mesmo `criado_em` poderiam trocar
    // de lugar entre uma pagina e outra — e um pedido que troca de lugar na
    // fronteira das paginas aparece duas vezes ou some. `numero` e identity,
    // entao e unico e cresce junto com a data.
    .order('numero', { ascending: false })
    // Itens em ordem fixa. Eles nascem no mesmo instante, entao `criado_em`
    // nao desempata nada; alfabetica pelo menos nao muda de um F5 para o outro.
    .order('nome', { referencedTable: 'order_items', ascending: true })
    .order('tamanho', { referencedTable: 'order_items', ascending: true })
    // Uma linha a mais do que cabe na pagina. Se ela voltar, existe proxima
    // pagina. Sai mais barato que um `count: 'exact'`, que faz o Postgres
    // contar a tabela inteira so para desenhar uma seta.
    .range(inicio, inicio + POR_PAGINA);

  if (error || !data) return { pedidos: [], temMais: false };

  return {
    pedidos: mapeiaPedidos(data.slice(0, POR_PAGINA)),
    temMais: data.length > POR_PAGINA,
  };
}
