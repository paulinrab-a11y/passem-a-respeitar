/**
 * Solicitacoes de pos-venda feitas pelo site (Issue #379).
 *
 * Funcao pura, sem `server-only`: a tela do pedido, o botao (componente de
 * cliente), o painel do dono e o teste leem daqui. A regra de QUANDO cabe
 * pedir mora no banco (`pos_venda_cabe`, migration 20261015190000); aqui fica
 * o que a tela oferece, que e a mesma regra lida de `posVendaDoPedido`. Se as
 * duas divergirem, o banco recusa e a tela diz por que — nunca o contrario.
 */

import type { PosVenda } from '@/lib/loja/termos';
import type { Database } from '@/lib/supabase/tipos';

export type TipoPosVenda = Database['public']['Enums']['tipo_pos_venda'];

/** A ordem e a dos botoes na tela. */
export const TIPOS_POS_VENDA = [
  'cancelamento',
  'arrependimento',
  'troca',
  'defeito',
] as const satisfies readonly TipoPosVenda[];

export function ehTipoPosVenda(valor: unknown): valor is TipoPosVenda {
  return typeof valor === 'string' && (TIPOS_POS_VENDA as readonly string[]).includes(valor);
}

/** Teto da mensagem, o mesmo da check constraint. */
export const MENSAGEM_MAX = 500;

/** Como o pedido aparece numa frase e no painel. */
export const NOME_DO_TIPO: Record<TipoPosVenda, string> = {
  cancelamento: 'Cancelamento',
  arrependimento: 'Desistência da compra',
  troca: 'Troca de tamanho',
  defeito: 'Defeito',
};

/** O botao: o que a pessoa quer, na voz dela. */
export const BOTAO_DO_TIPO: Record<TipoPosVenda, string> = {
  cancelamento: 'Pedir cancelamento',
  arrependimento: 'Quero desistir da compra',
  troca: 'Trocar o tamanho',
  defeito: 'Avisar de defeito',
};

/** O que a mensagem opcional pode dizer, por tipo. */
export const DICA_DA_MENSAGEM: Record<TipoPosVenda, string> = {
  cancelamento: 'Quer contar o motivo? (opcional)',
  arrependimento: 'Quer contar o motivo? (opcional)',
  troca: 'Para qual tamanho? (opcional)',
  defeito: 'O que aconteceu com a peça? (opcional)',
};

/**
 * Os pedidos que a pessoa pode abrir agora, pela etapa do pedido.
 *
 * Antes do envio, so cancelar. Depois da entrega, desistir e trocar dentro
 * dos prazos, e defeito sempre — o vicio oculto conta de quando aparece. Sem
 * a data de entrega registrada, os tres: o prazo conta de quando a pessoa
 * recebeu, e o banco nao sabe esse dia (o banco faz a mesma conta).
 *
 * A caminho (`enviado`) nao tem botao: nao da mais para cancelar, e a
 * desistencia comeca a contar quando chega. O e-mail continua valendo.
 */
export function tiposQueCabem(situacao: PosVenda | null): TipoPosVenda[] {
  if (!situacao) return [];
  if (situacao.etapa === 'antes-do-envio') return ['cancelamento'];
  if (situacao.etapa !== 'entregue') return [];

  const p = situacao.prazos;
  return [
    ...(!p || p.arrependimentoAberto ? (['arrependimento'] as const) : []),
    ...(!p || p.trocaAberta ? (['troca'] as const) : []),
    'defeito',
  ];
}

export type Solicitacao = {
  /** So o painel do dono le: e o que o botao de resolver manda. */
  id?: string;
  tipo: TipoPosVenda;
  protocolo: string;
  criadoEm: string;
  /** Nulo enquanto a loja nao resolveu. */
  resolvidaEm: string | null;
  mensagem: string | null;
};

export type LinhaDeSolicitacao = {
  id?: string;
  tipo: string;
  protocolo: string;
  criado_em: string;
  resolvida_em: string | null;
  mensagem: string | null;
};

/**
 * Da mais nova para a mais antiga. Tipo fora do enum (tipo novo antes de os
 * tipos gerados acompanharem) sai da lista em vez de virar rotulo vazio.
 */
export function mapeiaSolicitacoes(linhas: readonly LinhaDeSolicitacao[]): Solicitacao[] {
  return linhas
    .filter((l): l is LinhaDeSolicitacao & { tipo: TipoPosVenda } => ehTipoPosVenda(l.tipo))
    .map((l) => ({
      ...(l.id ? { id: l.id } : {}),
      tipo: l.tipo,
      protocolo: l.protocolo,
      criadoEm: l.criado_em,
      resolvidaEm: l.resolvida_em,
      mensagem: l.mensagem?.trim() || null,
    }))
    .sort((a, b) => b.criadoEm.localeCompare(a.criadoEm));
}

/** Os tipos com uma solicitacao aberta: o botao deles da lugar ao protocolo. */
export function tiposAbertos(solicitacoes: readonly Solicitacao[]): Set<TipoPosVenda> {
  return new Set(solicitacoes.filter((s) => !s.resolvidaEm).map((s) => s.tipo));
}
