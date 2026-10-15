import type { TipoPosVenda } from '@/lib/conta/pos-venda';

/**
 * Estado do pedido de cancelamento, desistencia, troca ou defeito (#379).
 * Arquivo separado da acao: `'use server'` so exporta funcao async.
 */
export type EstadoPosVenda = {
  /** Erro: o que deu errado e o que fazer. */
  erro: string | null;
  /**
   * Recebido: o que a tela mostra na hora (Decreto 7.962/2013, art. 5º,
   * § 4º). `jaExistia` quando a pessoa clicou de novo e a aberta era a mesma.
   */
  recebido: {
    tipo: TipoPosVenda;
    protocolo: string;
    criadoEm: string;
    jaExistia: boolean;
  } | null;
};

export const posVendaInicial: EstadoPosVenda = { erro: null, recebido: null };
