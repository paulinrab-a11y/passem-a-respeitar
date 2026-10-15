/**
 * A escolha que leva ao checkout (#356): quantas pecas cabem, e a URL.
 *
 * Sem `server-only` e sem zod: o seletor do checkout e o detalhe do pedido
 * sao de cliente, e nao precisam levar o zod junto.
 */

/**
 * Quantas pecas iguais o checkout oferece. O carrinho aceita ate 10, que e o
 * check do banco; o checkout e mais estreito de proposito: a camiseta e feita
 * sob encomenda, e tres ja e o pedido de quem compra para os amigos.
 */
export const MAX_NO_CHECKOUT = 3;

/**
 * O endereco do checkout para uma escolha.
 *
 * A URL carrega ESCOLHA — produto, tamanho, quantidade —, nunca preco: e o
 * servidor que le o catalogo. Montada num lugar so porque mais de um caminho
 * leva ao checkout (a troca de tamanho no proprio checkout, o "Fazer o pedido
 * de novo" do pedido vencido), e um parametro com nome diferente em um deles
 * abriria "Nao consegui montar este pedido".
 */
export function urlDoCheckout(slug: string, tamanho: string | null, quantidade = 1): string {
  const busca = new URLSearchParams({ p: slug });
  if (tamanho) busca.set('tam', tamanho);
  // Uma peca e o padrao da pagina; a URL da ficha da home nunca levou `q`.
  if (quantidade > 1) busca.set('q', String(quantidade));
  return `/checkout?${busca}`;
}
