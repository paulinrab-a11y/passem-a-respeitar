/**
 * Estados dos formularios da conta.
 *
 * Fora de `acoes.ts` pela mesma regra que derrubou a pagina de login: arquivo
 * com `'use server'` so pode exportar funcao async, e o build nao avisa.
 */

type Recado = {
  tom: 'ok' | 'erro';
  texto: string;
} | null;

export type EstadoNome = {
  recado: Recado;
  /** Contador de envios; vira `key` do recado para ele reanimar quando repete. */
  tentativa: number;
};

export const nomeInicial: EstadoNome = { recado: null, tentativa: 0 };

export type EstadoVerificacao = EstadoNome;
export const verificacaoInicial: EstadoVerificacao = { recado: null, tentativa: 0 };
