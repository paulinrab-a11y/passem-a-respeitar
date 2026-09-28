/**
 * Estado do formulario de senha. Fora de `acoes.ts` pela regra do Next:
 * arquivo com `'use server'` so exporta funcao async, e o build nao avisa.
 */
export type EstadoSenha = {
  recado: { tom: 'ok' | 'erro'; texto: string } | null;
  /** Campo que errou, para o foco e o `aria-invalid` (#51). */
  campo: 'atual' | 'nova' | 'confirmacao' | null;
  tentativa: number;
};

export const senhaInicial: EstadoSenha = { recado: null, campo: null, tentativa: 0 };
