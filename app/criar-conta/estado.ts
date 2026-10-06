/**
 * Estado do formulario de cadastro (Issue #30). Fora de `acoes.ts` pela
 * regra do Next: arquivo com `'use server'` so exporta funcao async.
 */
export type EstadoCriarConta = {
  erro: string | null;
  /** Campo que errou, para o foco e o `aria-invalid`. */
  campo: string | null;
  /**
   * E-mail para onde o codigo foi. Quando preenchido, o formulario da lugar ao
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

/**
 * Estado da tela do codigo (#224). Dois formularios, dois estados: confirmar
 * e reenviar sao acoes diferentes, com limites e mensagens diferentes.
 */
export type EstadoCodigo = {
  erro: string | null;
  tentativa: number;
};

export const codigoInicial: EstadoCodigo = { erro: null, tentativa: 0 };

export type EstadoReenvio = {
  erro: string | null;
  /** Recado de sucesso — o mesmo para e-mail novo e para e-mail que ja existia. */
  aviso: string | null;
  /** Quando o ultimo reenvio saiu; a tela conta 60 s a partir dai. */
  reenviadoEm: number | null;
  tentativa: number;
};

export const reenvioInicial: EstadoReenvio = {
  erro: null,
  aviso: null,
  reenviadoEm: null,
  tentativa: 0,
};
