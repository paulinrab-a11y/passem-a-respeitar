/**
 * Estado do formulario de senha. Fora de `acoes.ts` pela regra do Next:
 * arquivo com `'use server'` so exporta funcao async, e o build nao avisa.
 */
export type EstadoSenha = {
  recado: { tom: 'ok' | 'erro'; texto: string } | null;
  tentativa: number;
};

export const senhaInicial: EstadoSenha = { recado: null, tentativa: 0 };
