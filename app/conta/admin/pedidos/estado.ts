/**
 * Estado do formulario administrativo (Issue #43). Arquivo separado da acao
 * pelo mesmo motivo de app/checkout/estado.ts: `'use server'` so exporta
 * funcao async.
 */
export type EstadoAdmin = {
  recado: { tom: 'ok' | 'erro'; texto: string } | null;
  /** O pedido a que o recado se refere, para a tela mostrar no card certo. */
  pedido: string | null;
  /**
   * Reembolsar e cancelar pedem login recente (#351), como as acoes da #40.
   * A tela guarda o botao e o motivo, pede a senha e refaz a mesma mudanca.
   * A janela vem junto para o modal dizer quanto tempo vale: a constante mora
   * num modulo so de servidor.
   */
  precisaReautenticar?: { minutos: number };
};

export const adminInicial: EstadoAdmin = { recado: null, pedido: null };
