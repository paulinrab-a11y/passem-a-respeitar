/**
 * Painel de pedidos do dono (Issue #242): filtro, pagina e contadores.
 *
 * So funcao pura, como lib/conta/pedidos.ts. A consulta mora na pagina, que e
 * server-only; o que esta aqui e o que daria errado em silencio — um `?status=`
 * inventado virando filtro, um `?p=abc` virando offset — e por isso se testa
 * sem banco.
 */

import { z } from 'zod';
import { STATUS_PEDIDO, type StatusPedido } from '@/lib/loja/status-do-pedido';
import { type EntregaDoPedido, leStatus, paginaValida } from './pedidos';

export const PAINEL = '/conta/admin/pedidos';

/**
 * O que o dono pode escolher ver.
 *
 * `a-enviar` e o padrao, e e um filtro COMPOSTO: pago e em producao sao os
 * pedidos que precisam de etiqueta, e e isso que o dono abre o painel para
 * saber. Antes a lista eram os 50 mais recentes de qualquer status — bastavam
 * 50 abandonos de Pix para os pedidos pagos sumirem da tela (#17).
 */
export type FiltroAdmin = 'a-enviar' | 'todos' | StatusPedido;

export const FILTRO_PADRAO: FiltroAdmin = 'a-enviar';

/** Na ordem em que aparecem na tela: o padrao, cada status, e tudo. */
export const FILTROS_ADMIN: readonly { valor: FiltroAdmin; rotulo: string }[] = [
  { valor: 'a-enviar', rotulo: 'Para enviar' },
  ...STATUS_PEDIDO.map((status) => ({ valor: status, rotulo: leStatus(status).rotulo })),
  { valor: 'todos', rotulo: 'Todos' },
];

const VALORES = FILTROS_ADMIN.map((f) => f.valor) as [FiltroAdmin, ...FiltroAdmin[]];

/**
 * O que a URL pode trazer. Repetido (`?status=a&status=b`) vale o primeiro,
 * como `paginaValida` ja faz com `p`. Fora da lista cai no padrao, em vez de
 * virar um `in()` com valor que o enum do banco recusaria com erro na tela.
 */
const esquemaBusca = z.object({
  status: z.preprocess((v) => (Array.isArray(v) ? v[0] : v), z.enum(VALORES).catch(FILTRO_PADRAO)),
  p: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .catch(undefined)
    .transform(paginaValida),
});

export type BuscaAdmin = { filtro: FiltroAdmin; pagina: number };

export function leBuscaAdmin(bruto: unknown): BuscaAdmin {
  const lido = esquemaBusca.safeParse(bruto);
  // So falha quando `bruto` nem objeto e; os campos, um a um, sempre caem no
  // padrao. Mesmo assim, uma tela em branco nao e resposta para URL torta.
  if (!lido.success) return { filtro: FILTRO_PADRAO, pagina: 1 };
  return { filtro: lido.data.status, pagina: lido.data.p };
}

/** Quais status um filtro alcanca. `null` e "todos": a consulta nao filtra. */
export function statusDoFiltro(filtro: FiltroAdmin): StatusPedido[] | null {
  if (filtro === 'todos') return null;
  if (filtro === 'a-enviar') return ['pago', 'em_producao'];
  return [filtro];
}

/**
 * Quantos pedidos ha em cada status, e no total. Vem de uma consulta so
 * (`conta_pedidos_por_status`): contar com um `count: 'exact'` por filtro
 * seriam nove idas ao banco para desenhar nove numeros.
 */
export type Contagem = { porStatus: Partial<Record<StatusPedido, number>>; total: number };

export function montaContagem(linhas: { status: string; total: number }[]): Contagem {
  const porStatus: Partial<Record<StatusPedido, number>> = {};
  let total = 0;

  for (const l of linhas) {
    total += l.total;
    // Status que o TypeScript nao conhece (enum novo, tipos nao regenerados)
    // conta em "todos" e em mais nenhum — mesma tolerancia de `leStatus`.
    if ((STATUS_PEDIDO as string[]).includes(l.status)) {
      porStatus[l.status as StatusPedido] = l.total;
    }
  }

  return { porStatus, total };
}

export function contaNoFiltro(contagem: Contagem, filtro: FiltroAdmin): number {
  const alvo = statusDoFiltro(filtro);
  if (!alvo) return contagem.total;
  return alvo.reduce((soma, status) => soma + (contagem.porStatus[status] ?? 0), 0);
}

/**
 * O endereco de uma pagina do painel. A pagina 1 e o filtro padrao nao vao
 * para a URL: e o mesmo conteudo em dois enderecos, e o curto e o que o dono
 * guarda no favorito — mesma regra da lista de pedidos do cliente.
 */
export function urlDoPainel(filtro: FiltroAdmin, pagina = 1): string {
  const busca = new URLSearchParams();
  if (filtro !== FILTRO_PADRAO) busca.set('status', filtro);
  if (pagina > 1) busca.set('p', String(pagina));

  const texto = busca.toString();
  return texto ? `${PAINEL}?${texto}` : PAINEL;
}

/**
 * O endereco como vai para a etiqueta: quatro linhas, destinatario primeiro.
 * E o mesmo texto que o card mostra aberto e que o botao copia — se os dois
 * fossem montados em lugares diferentes, um dia um deles ficaria sem o
 * complemento.
 */
export function linhasDaEntrega(e: EntregaDoPedido): string[] {
  const complemento = e.complemento ? `, ${e.complemento}` : '';
  return [
    e.nome,
    `${e.logradouro}, ${e.numero}${complemento}`,
    `${e.bairro} — ${e.cidade}/${e.uf}`,
    `CEP ${e.cep}`,
  ];
}
