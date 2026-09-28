/** Estado do pedido de recuperacao (Issue #32). Fora de `acoes.ts` pela regra do `'use server'`. */
export type EstadoRecuperar = {
  erro: string | null;
  /** Campo que errou, para o `aria-invalid` (#51). Limite de pedidos nao aponta campo. */
  campo: 'email' | null;
  /** O pedido foi aceito. A tela troca o formulario pelo recado — exista a conta ou nao. */
  enviado: boolean;
  tentativa: number;
};

export const recuperarInicial: EstadoRecuperar = {
  erro: null,
  campo: null,
  enviado: false,
  tentativa: 0,
};
