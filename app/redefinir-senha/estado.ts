/** Estado da redefinicao de senha (Issue #32). Fora de `acoes.ts` pela regra do `'use server'`. */
export type EstadoRedefinir = {
  erro: string | null;
  campo: string | null;
  tentativa: number;
};

export const redefinirInicial: EstadoRedefinir = { erro: null, campo: null, tentativa: 0 };
