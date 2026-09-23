export type EstadoSessao = {
  recado: { tom: 'ok' | 'erro'; texto: string } | null;
  /** Identificador que acabou de ser encerrado, para a linha sair animada. */
  encerrado: string | null;
  /**
   * A janela de autenticacao recente venceu (#40). A tela guarda o que a
   * pessoa tentou fazer, pede a senha, e refaz a acao com os mesmos dados.
   */
  precisaReautenticar?: true;
};

export const sessaoInicial: EstadoSessao = { recado: null, encerrado: null };
