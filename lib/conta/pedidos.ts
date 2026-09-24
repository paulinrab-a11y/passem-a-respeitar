/**
 * Pedido visto pela tela de "Meus pedidos" (Issue #41).
 *
 * So funcao pura aqui: rotulo, dinheiro e o mapper. A consulta mora em
 * app/conta/pedidos/lista-pedidos.ts, que e server-only. A divisao existe para
 * este arquivo poder ser testado sem banco e sem navegador — e e onde estao as
 * decisoes que dariam errado em silencio.
 */

import type { Database } from '@/lib/supabase/tipos';
import { type EventoDoBanco, type LinhaDoTempo, montaLinhaDoTempo } from './linha-do-tempo';

type StatusPedido = Database['public']['Enums']['status_pedido'];

/** Quantos pedidos por pagina. Criterio da #41. */
export const POR_PAGINA = 20;

/**
 * Teto de pagina. Nao e defesa contra ataque — a consulta filtra por usuario e
 * usa indice, entao um offset absurdo volta vazio rapido. E para `?p=1e9` nao
 * virar um `range` que o PostgREST recusa com erro 416 e a pessoa ver a tela
 * quebrada em vez da lista.
 */
const PAGINA_MAX = 500;

/**
 * Tom visual do status. Tres, nao sete:
 *
 *   atencao  — a bola esta com a pessoa (vermelho)
 *   normal   — esta andando, nao ha o que fazer (branco)
 *   apagado  — acabou e nao vai mudar (cinza)
 *
 * Um tom por status daria sete cores numa identidade de tres. O que a lista
 * precisa responder e "preciso fazer alguma coisa?", e isso tem tres respostas.
 */
export type Tom = 'atencao' | 'normal' | 'apagado';

const STATUS: Record<StatusPedido, { rotulo: string; tom: Tom }> = {
  aguardando_pagamento: { rotulo: 'Aguardando pagamento', tom: 'atencao' },
  pago: { rotulo: 'Pago', tom: 'normal' },
  em_producao: { rotulo: 'Em produção', tom: 'normal' },
  enviado: { rotulo: 'Enviado', tom: 'normal' },
  entregue: { rotulo: 'Entregue', tom: 'normal' },
  cancelado: { rotulo: 'Cancelado', tom: 'apagado' },
  reembolsado: { rotulo: 'Reembolsado', tom: 'apagado' },
};

/**
 * O parametro e `string`, e nao `StatusPedido`, de proposito.
 *
 * O `Record` acima ja obriga quem adicionar um valor no enum a escrever o
 * rotulo — mas so depois de alguem rodar `supabase gen types` de novo, e isso
 * e passo manual (ver o cabecalho de tipos.ts). Entre "a lista inteira quebra
 * porque um pedido tem status novo" e "um pedido aparece com rotulo generico",
 * o segundo e melhor para quem so queria ver onde esta a camiseta.
 */
export function leStatus(status: string): { rotulo: string; tom: Tom } {
  // `Object.hasOwn` e nao `?? padrao`: `STATUS['constructor']` devolve a funcao
  // herdada do prototipo, o `??` nao dispara, e a tela sai com rotulo vazio.
  // Nenhum status do enum se chama assim — mas o dia em que esta funcao receber
  // string de outro lugar nao vai vir avisando.
  if (Object.hasOwn(STATUS, status)) return STATUS[status as StatusPedido];
  return { rotulo: 'Em andamento', tom: 'normal' };
}

const dinheiro = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** Centavos inteiros para `R$ 120,00`. O banco guarda inteiro; so a tela divide. */
export function reais(centavos: number) {
  return dinheiro.format(centavos / 100);
}

type ItemDoPedido = {
  id: string;
  nome: string;
  tamanho: string | null;
  quantidade: number;
  precoUnitario: string;
};

export type Pedido = {
  /**
   * Id do pedido. Entrou na #42, quando passou a existir uma pagina de detalhe
   * para linkar. Continua sendo uuid e nao `numero` porque numero sequencial
   * em URL entrega quantos pedidos a loja ja fez — a razao esta na migration
   * 20260923120000.
   */
  id: string;
  numero: number;
  criadoEm: string;
  rotulo: string;
  tom: Tom;
  total: string;
  itens: ItemDoPedido[];
};

type LinhaItem = {
  id: string;
  nome: string;
  tamanho: string | null;
  quantidade: number;
  preco_unitario_centavos: number;
};

type LinhaPedido = {
  id: string;
  numero: number;
  criado_em: string;
  status: string;
  total_centavos: number;
  order_items: LinhaItem[];
};

/**
 * Mapper explicito (#20).
 *
 * O que NAO sai daqui e a parte que importa: `user_id`, `pagamento_id`,
 * `pagamento_provedor`, `atualizado_em`, `anonimizado_em`. Nada disso aparece
 * na tela, entao nada disso precisa chegar no HTML.
 *
 * `orders.id` passou a sair na #42: e o endereco da pagina de detalhe, entao
 * e dado que a tela usa, nao coluna interna vazando de carona.
 *
 * `order_items.id` fica so por ser a chave do React na lista. E a linha do
 * proprio usuario, e uma chave precisa ser estavel e unica — que e a definicao
 * de chave primaria.
 */
function mapeiaItens(itens: LinhaItem[]): ItemDoPedido[] {
  return itens.map((i) => ({
    id: i.id,
    nome: i.nome,
    tamanho: i.tamanho,
    quantidade: i.quantidade,
    precoUnitario: reais(i.preco_unitario_centavos),
  }));
}

export function mapeiaPedidos(linhas: LinhaPedido[]): Pedido[] {
  return linhas.map((l) => {
    const { rotulo, tom } = leStatus(l.status);

    return {
      id: l.id,
      numero: l.numero,
      criadoEm: l.criado_em,
      rotulo,
      tom,
      total: reais(l.total_centavos),
      itens: mapeiaItens(l.order_items),
    };
  });
}

/**
 * Numero da pagina vindo da URL.
 *
 * `?p=` chega de fora, entao e afirmacao e nao fato — mesma regra do `next` em
 * rotas.ts. Qualquer coisa que nao seja inteiro >= 1 vira pagina 1, em vez de
 * virar `NaN` dentro de um calculo de offset.
 */
export function paginaValida(bruto: string | string[] | undefined): number {
  const texto = Array.isArray(bruto) ? bruto[0] : bruto;
  if (!texto) return 1;

  const n = Number(texto);
  if (!Number.isInteger(n) || n < 1) return 1;

  return Math.min(n, PAGINA_MAX);
}

/**
 * UUID v4 canonico. A rota de detalhe confere ANTES de falar com o banco: um
 * id torto viraria erro do PostgREST, e erro do PostgREST na tela e diferente
 * de "nao existe" — a diferenca por si ja conta alguma coisa a quem chutou.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function pareceUuid(bruto: string | undefined): boolean {
  return Boolean(bruto) && UUID.test(bruto as string);
}

export type PedidoDetalhado = {
  numero: number;
  criadoEm: string;
  rotulo: string;
  tom: Tom;
  total: string;
  /**
   * O mesmo valor em centavos. Entrou na #108: o Payment Brick recebe numero,
   * e reconverter `total` de volta para numero seria formatar para desformatar.
   */
  totalCentavos: number;
  /**
   * O pedido ainda espera pagamento. Entrou na #114: e o unico status em que
   * vale perguntar ao provedor se algo mudou — e, na #113, em que faz sentido
   * oferecer pagar.
   */
  aguardandoPagamento: boolean;
  itens: ItemDoPedido[];
  /**
   * Ja montada aqui, e nao na pagina. Assim a pagina nao ve os eventos crus —
   * nao tem como derivar deles uma etapa que o banco nao registrou, que e
   * exatamente o que a #42 pede para nao acontecer.
   */
  linhaDoTempo: LinhaDoTempo;
};

type LinhaDetalhe = LinhaPedido & { order_status_history: EventoDoBanco[] };

/**
 * Mapper do detalhe (#20).
 *
 * O que fica de fora da trilha, de proposito: `autor` e `motivo`. `autor` e o
 * uuid de quem mudou o status — numa mudanca administrativa, de alguem que nao
 * e o dono do pedido. `motivo` e texto escrito para uso interno enquanto a #43
 * nao definir quem escreve e para quem. Nenhum dos dois esta nos criterios da
 * #42, e coluna que ninguem pediu nao precisa sair do banco.
 */
export function mapeiaDetalhe(linha: LinhaDetalhe): PedidoDetalhado {
  const { rotulo, tom } = leStatus(linha.status);

  return {
    numero: linha.numero,
    criadoEm: linha.criado_em,
    rotulo,
    tom,
    total: reais(linha.total_centavos),
    totalCentavos: linha.total_centavos,
    aguardandoPagamento: linha.status === 'aguardando_pagamento',
    itens: mapeiaItens(linha.order_items),
    linhaDoTempo: montaLinhaDoTempo(linha.status, linha.order_status_history),
  };
}
