/**
 * Estado da troca de e-mail (Issue #36). Fora do arquivo da acao pela regra
 * do Next: `'use server'` so exporta funcao async, e o build nao avisa.
 */
export type EstadoEmail = {
  recado: { tom: 'ok' | 'erro'; texto: string } | null;
  /** Campo que errou, para o foco e o `aria-invalid`. */
  campo: 'email' | 'senha' | null;
  tentativa: number;
};

export const emailInicial: EstadoEmail = { recado: null, campo: null, tentativa: 0 };

export type EstadoCancelamento = {
  recado: { tom: 'ok' | 'erro'; texto: string } | null;
};

export const cancelamentoInicial: EstadoCancelamento = { recado: null };
