export type EstadoExclusao = {
  recado: { tom: 'ok' | 'erro'; texto: string } | null;
};

export const exclusaoInicial: EstadoExclusao = { recado: null };
