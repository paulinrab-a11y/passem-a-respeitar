export type EstadoSessao = {
  recado: { tom: 'ok' | 'erro'; texto: string } | null;
  /** Identificador que acabou de ser encerrado, para a linha sair animada. */
  encerrado: string | null;
};

export const sessaoInicial: EstadoSessao = { recado: null, encerrado: null };
