/**
 * Estado do formulario de cadastro (Issue #30). Fora de `acoes.ts` pela
 * regra do Next: arquivo com `'use server'` so exporta funcao async.
 */
export type EstadoCriarConta = {
  erro: string | null;
  /** Campo que errou, para o foco e o `aria-invalid`. */
  campo: string | null;
  /**
   * E-mail para onde o link foi. Quando preenchido, o formulario da lugar ao
   * recado de "confira a caixa de entrada" — e e o MESMO recado para conta
   * nova e para e-mail que ja existia.
   */
  enviadoPara: string | null;
  /** Contador de envios; `key` do erro para ele reanimar quando repete. */
  tentativa: number;
};

export const criarContaInicial: EstadoCriarConta = {
  erro: null,
  campo: null,
  enviadoPara: null,
  tentativa: 0,
};
