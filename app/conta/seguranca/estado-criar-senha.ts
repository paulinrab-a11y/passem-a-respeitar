/**
 * Estados de "Criar senha" (#389). Fora de `criar-senha.ts` pela regra do
 * Next: arquivo com `'use server'` so exporta funcao async.
 */
type Recado = { tom: 'ok' | 'erro'; texto: string } | null;

/** Pedir o codigo. `enviadoEm` recomeca a espera do botao. */
export type EstadoEnvioDaSenha = {
  recado: Recado;
  enviadoEm: number | null;
  tentativa: number;
};

export const envioDaSenhaInicial: EstadoEnvioDaSenha = {
  recado: null,
  enviadoEm: null,
  tentativa: 0,
};

/** Criar a senha com o codigo. `criada` troca a tela por "Trocar senha". */
export type EstadoCriarSenha = {
  recado: Recado;
  /** Campo que errou, para o foco e o `aria-invalid` (#51). */
  campo: 'codigo' | 'nova' | 'confirmacao' | null;
  tentativa: number;
  criada?: boolean;
};

export const criarSenhaInicial: EstadoCriarSenha = { recado: null, campo: null, tentativa: 0 };
