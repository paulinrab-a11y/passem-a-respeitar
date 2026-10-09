/**
 * Estado do formulario de entrega.
 *
 * Arquivo separado da acao porque um arquivo `'use server'` so pode exportar
 * funcao async — exportar um objeto dali derruba a pagina em runtime, com o
 * build passando. Ja me pegou na #31.
 */

export type EstadoDoCheckout = {
  recado: { tom: 'ok' | 'erro'; texto: string } | null;
  /** Nome do campo que errou, para o foco e o `aria-invalid`. */
  campo?: string | null;
  /**
   * Para onde ir depois do sucesso. O CLIENTE navega, com carregamento
   * completo — nao a acao com `redirect()`. No App Router, `redirect()` em
   * server action e navegacao suave: o documento continua sendo o do
   * /checkout, e a CSP em vigor e a dele. A tela de pagamento precisa da
   * propria CSP para o Brick montar, e so a ganha como documento. (#118)
   */
  irPara?: string | null;
  /**
   * A criacao do pedido recusou o frete (#265): a caixa esquece a cotacao que
   * mostrava e cota de novo. Um sim ou nao, e nao o motivo — a tela nao
   * compara frases, e a rede nao leva o que falta configurar.
   */
  recotarFrete?: boolean;
};

export const checkoutInicial: EstadoDoCheckout = { recado: null, campo: null };
