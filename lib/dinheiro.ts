/**
 * Dinheiro para a tela (#353).
 *
 * Modulo proprio, sem import nenhum, porque o navegador tambem formata preco
 * (a cotacao do frete na home e no checkout). Morando em lib/conta/pedidos.ts,
 * levava junto o endereco e o zod inteiro para o bundle do cliente.
 */

const dinheiro = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** Centavos inteiros para `R$ 120,00`. O banco guarda inteiro; so a tela divide. */
export function reais(centavos: number) {
  return dinheiro.format(centavos / 100);
}
