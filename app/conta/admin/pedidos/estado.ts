/**
 * Estado do formulario administrativo (Issue #43). Arquivo separado da acao
 * pelo mesmo motivo de app/checkout/estado.ts: `'use server'` so exporta
 * funcao async.
 */
export type EstadoAdmin = {
  recado: { tom: 'ok' | 'erro'; texto: string } | null;
  /** O pedido a que o recado se refere, para a tela mostrar no card certo. */
  pedido: string | null;
};

export const adminInicial: EstadoAdmin = { recado: null, pedido: null };
