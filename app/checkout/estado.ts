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
};

export const checkoutInicial: EstadoDoCheckout = { recado: null, campo: null };
