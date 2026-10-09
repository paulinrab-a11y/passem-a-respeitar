/**
 * Estado da tela do codigo (#224, #260). Fora dos arquivos de acao pela regra
 * do Next: arquivo com `'use server'` so exporta funcao async.
 *
 * Dois formularios, dois estados: confirmar e reenviar sao acoes diferentes,
 * com limites e mensagens diferentes. As tres telas que pedem o codigo —
 * cadastro, login de conta nao confirmada e o aviso de /conta — usam os
 * mesmos dois, e por isso eles moram aqui e nao na pasta de uma delas.
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
  /** Quando o ultimo reenvio saiu; a tela conta a espera a partir dai. */
  reenviadoEm: number | null;
  tentativa: number;
};

export const reenvioInicial: EstadoReenvio = {
  erro: null,
  aviso: null,
  reenviadoEm: null,
  tentativa: 0,
};
