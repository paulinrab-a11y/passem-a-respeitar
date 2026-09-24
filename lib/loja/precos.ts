/**
 * Precificacao do carrinho (Issue #99).
 *
 * Funcao pura: recebe o que o navegador pediu e o que o banco respondeu, e
 * devolve o valor. Sem Supabase e sem React, para poder ser testada sozinha —
 * e e aqui que mora a garantia de dinheiro do projeto.
 *
 * A garantia nao e um `if` que compara o preco do cliente com o do banco. E o
 * tipo: `ItemDoCarrinho` NAO TEM campo de preco. Nao existe valor vindo do
 * navegador para conferir, entao nao existe conferencia para alguem esquecer.
 * Mesma ideia do `Resultado` da #42 — a garantia esta na forma, nao na
 * disciplina de quem escreve o proximo galho.
 */

import { z } from 'zod';

/** Quantas linhas distintas cabem num carrinho. */
const MAX_LINHAS = 20;

/** Bate com o check de `order_items.quantidade`. */
const MAX_POR_ITEM = 10;

/**
 * Teto do carrinho: R$ 100.000,00.
 *
 * Nao e regra de negocio, e barreira. `orders.total_centavos` e `integer`, e um
 * carrinho absurdo estouraria o int4 no insert — erro de banco no meio do
 * checkout em vez de uma recusa limpa.
 */
const MAX_TOTAL_CENTAVOS = 10_000_000;

const TAMANHOS = ['P', 'M', 'G', 'GG', 'XGG'] as const;

/**
 * O que o navegador pode mandar. Repare no que nao esta aqui: preco, subtotal,
 * total, nome, desconto. Nada disso e opiniao do cliente.
 *
 * `parse` devolve so o que o schema descreve, entao um `preco` a mais no corpo
 * nao vira propriedade no objeto que segue adiante. E o anti mass assignment da
 * #19 na forma mais barata que existe.
 */
export const esquemaItemDoCarrinho = z.object({
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]{1,60}$/),
  // `null` e produto sem tamanho. O default existe porque um corpo sem a chave
  // e valido para adesivo e poster.
  tamanho: z.enum(TAMANHOS).nullable().default(null),
  quantidade: z.number().int().min(1).max(MAX_POR_ITEM),
});

export const esquemaCarrinho = z.object({
  itens: z.array(esquemaItemDoCarrinho).min(1).max(MAX_LINHAS),
});

export type ItemDoCarrinho = z.infer<typeof esquemaItemDoCarrinho>;

/** Uma variacao como o banco entrega. O preco chega SO por aqui. */
export type VariacaoDoBanco = {
  slug: string;
  nome: string;
  tamanho: string | null;
  precoCentavos: number;
};

/** Uma linha pronta. Os nomes batem com as colunas de `order_items` de proposito. */
export type LinhaPrecificada = {
  produtoSlug: string;
  nome: string;
  tamanho: string | null;
  quantidade: number;
  precoUnitarioCentavos: number;
  subtotalCentavos: number;
};

export type MotivoDaRecusa =
  | 'carrinho-vazio'
  | 'carrinho-grande-demais'
  | 'quantidade-invalida'
  | 'produto-indisponivel'
  | 'valor-alto-demais';

export type Precificacao =
  | { ok: true; linhas: LinhaPrecificada[]; subtotalCentavos: number }
  | { ok: false; motivo: MotivoDaRecusa };

/** Chave da variacao. Produto sem tamanho usa string vazia, nunca `undefined`. */
function chave(slug: string, tamanho: string | null): string {
  return `${slug}\u0000${tamanho ?? ''}`;
}

/**
 * Junta linhas repetidas antes de conferir a quantidade.
 *
 * Sem isto o limite de 10 por item nao vale nada: bastava mandar cinco linhas
 * da mesma camiseta M com 10 em cada uma e levar 50. O limite e por variacao,
 * entao a soma tem que acontecer antes do limite, nao depois.
 */
function juntaRepetidos(itens: ItemDoCarrinho[]): Map<string, ItemDoCarrinho> {
  const juntos = new Map<string, ItemDoCarrinho>();

  for (const item of itens) {
    const k = chave(item.slug, item.tamanho);
    const jaTem = juntos.get(k);

    if (jaTem) jaTem.quantidade += item.quantidade;
    else juntos.set(k, { ...item });
  }

  return juntos;
}

/**
 * O valor do carrinho, calculado a partir do catalogo.
 *
 * `catalogo` sao as variacoes que o banco devolveu para os slugs pedidos —
 * so as ativas, porque a RLS ja cuidou disso na consulta. Um item pedido que
 * nao esta na lista e indisponivel: pode nao existir, pode estar desativado,
 * pode ser tamanho que o produto nao tem. As tres respondem igual, e de
 * proposito: dizer qual das tres e contaria o catalogo a quem esta sondando.
 */
export function precifica(itens: ItemDoCarrinho[], catalogo: VariacaoDoBanco[]): Precificacao {
  if (itens.length === 0) return { ok: false, motivo: 'carrinho-vazio' };
  if (itens.length > MAX_LINHAS) return { ok: false, motivo: 'carrinho-grande-demais' };

  // Map, nunca objeto literal: a chave vem de fora, e em objeto literal
  // `constructor` acha a funcao herdada do prototipo. Ja me pegou na #41.
  const precos = new Map(catalogo.map((v) => [chave(v.slug, v.tamanho), v]));

  const linhas: LinhaPrecificada[] = [];
  let subtotalCentavos = 0;

  for (const item of juntaRepetidos(itens).values()) {
    if (!Number.isInteger(item.quantidade) || item.quantidade < 1) {
      return { ok: false, motivo: 'quantidade-invalida' };
    }
    if (item.quantidade > MAX_POR_ITEM) {
      return { ok: false, motivo: 'quantidade-invalida' };
    }

    const variacao = precos.get(chave(item.slug, item.tamanho));
    if (!variacao) return { ok: false, motivo: 'produto-indisponivel' };

    // O banco ja barra preco <= 0 por check constraint. A conferencia aqui e
    // para o caso de esta funcao um dia receber catalogo de outra origem — e
    // custa uma linha.
    if (!Number.isInteger(variacao.precoCentavos) || variacao.precoCentavos <= 0) {
      return { ok: false, motivo: 'produto-indisponivel' };
    }

    const subtotal = variacao.precoCentavos * item.quantidade;
    subtotalCentavos += subtotal;

    linhas.push({
      produtoSlug: variacao.slug,
      nome: variacao.nome,
      tamanho: variacao.tamanho,
      quantidade: item.quantidade,
      precoUnitarioCentavos: variacao.precoCentavos,
      subtotalCentavos: subtotal,
    });
  }

  if (subtotalCentavos > MAX_TOTAL_CENTAVOS) {
    return { ok: false, motivo: 'valor-alto-demais' };
  }

  return { ok: true, linhas, subtotalCentavos };
}

/** Total de pecas. O frete pergunta isto. */
export function pecasDe(linhas: LinhaPrecificada[]): number {
  return linhas.reduce((soma, l) => soma + l.quantidade, 0);
}

/**
 * O numero grande da ficha, sem o "R$".
 *
 * A ficha da home tem uma marcacao propria — `<small>R$</small>120` — em que o
 * simbolo e um elemento separado, menor. Por isso nao da para usar o
 * `Intl.NumberFormat` de moeda aqui: ele devolve tudo junto numa string so.
 *
 * Preco redondo sai sem centavos, como esta no ar hoje: `120`, nao `120,00`.
 */
export function precoNaFicha(centavos: number): string {
  const emReais = centavos / 100;
  return Number.isInteger(emReais) ? String(emReais) : emReais.toFixed(2).replace('.', ',');
}
