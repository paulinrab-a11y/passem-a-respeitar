/**
 * Transicoes de status do pedido que uma PESSOA pode fazer (Issue #43).
 *
 * Funcao pura. A mesma tabela existe em SQL, dentro de `muda_status_pedido`,
 * e um teste compara as duas: a rota valida antes para dar mensagem boa; o
 * banco valida de novo porque rota se esquece.
 *
 * O que nao esta aqui e o que importa:
 *
 *   - `pago` nao e destino. Pagamento quem confirma e o provedor, pelo
 *     webhook ou pela conciliacao. Uma pessoa marcando "pago" na mao e
 *     mercadoria saindo sem dinheiro entrando.
 *   - `aguardando_pagamento` nao e destino. Nao se "despaga" um pedido.
 *   - `cancelado` e `reembolsado` sao finais. Dali nao se volta.
 */

import type { Database } from '@/lib/supabase/tipos';

export type StatusPedido = Database['public']['Enums']['status_pedido'];

const TRANSICOES: Record<StatusPedido, readonly StatusPedido[]> = {
  aguardando_pagamento: ['cancelado'],
  pago: ['em_producao', 'cancelado', 'reembolsado'],
  em_producao: ['enviado', 'cancelado', 'reembolsado'],
  enviado: ['entregue', 'reembolsado'],
  entregue: ['reembolsado'],
  cancelado: [],
  reembolsado: [],
};

export const STATUS_PEDIDO = Object.keys(TRANSICOES) as StatusPedido[];

export function ehStatusPedido(valor: unknown): valor is StatusPedido {
  return typeof valor === 'string' && Object.hasOwn(TRANSICOES, valor);
}

/** Para onde um pedido neste status pode ir, na ordem em que os botoes aparecem. */
export function proximosDe(de: StatusPedido): readonly StatusPedido[] {
  return TRANSICOES[de];
}

export function transicaoPermitida(de: StatusPedido, para: StatusPedido): boolean {
  return TRANSICOES[de].includes(para);
}

/**
 * De onde se chega a um status: a tabela lida ao contrario. E o que a
 * automacao usa para saber que pedidos um estorno no provedor alcanca (#7) —
 * os mesmos de onde uma pessoa poderia reembolsar, e nenhum a mais.
 */
export function origensDe(para: StatusPedido): StatusPedido[] {
  return STATUS_PEDIDO.filter((de) => TRANSICOES[de].includes(para));
}

/** Verbo do botao. Curto, no imperativo: e o que a pessoa vai fazer. */
export const VERBO: Record<StatusPedido, string> = {
  aguardando_pagamento: 'Aguardar pagamento',
  pago: 'Marcar pago',
  em_producao: 'Pôr em separação',
  enviado: 'Marcar enviado',
  entregue: 'Marcar entregue',
  cancelado: 'Cancelar',
  reembolsado: 'Reembolsar',
};
