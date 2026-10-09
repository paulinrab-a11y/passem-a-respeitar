import 'server-only';

/**
 * Leitura do catalogo (Issue #99).
 *
 * Tres funcoes, dois publicos:
 *
 *   `vitrine()`       — o que a home mostra
 *   `orcamento()`     — o que o checkout cobra
 *   `opcoesDeFrete()` — PAC e SEDEX, para o checkout mostrar (#199)
 *
 * As duas leem a MESMA tabela. Nao ha um preco "de exibicao" e outro "de
 * cobranca": se divergissem, a pessoa veria um numero e pagaria outro, e a
 * divergencia so apareceria no extrato dela.
 *
 * O client aqui e o publishable, igual ao do navegador. Nao e descuido: o
 * catalogo e publico, e a RLS ja limita as linhas as ativas e o GRANT ja limita
 * as colunas. `estoque` nao esta concedido para este papel e por isso nao e
 * lido aqui — quem confere e baixa o numero e `cria_pedido`, no banco, na
 * mesma transacao que grava o pedido (#296).
 */

import {
  cotaFrete,
  type MotivoDoFrete,
  type OpcaoDeFrete,
  type Servico,
  type Volume,
} from '@/lib/loja/frete';
import {
  type ItemDoCarrinho,
  type LinhaPrecificada,
  type MotivoDaRecusa,
  precifica,
  type VariacaoDoBanco,
} from '@/lib/loja/precos';
import { clienteServidor } from '@/lib/supabase/servidor';
import { type LinhaDoGuia, leGuia } from './guia-de-tamanhos';

type VariacaoDaVitrine = {
  tamanho: string | null;
  precoCentavos: number;
};

export type ProdutoDaVitrine = {
  slug: string;
  nome: string;
  descricao: string | null;
  /** Ja na ordem do catalogo: P, M, G, GG — nao alfabetica. */
  variacoes: VariacaoDaVitrine[];
  /** Menor preco entre as variacoes. E o numero grande da ficha. */
  precoCentavos: number;
  /** Medidas por tamanho (#206). Nulo: produto sem guia, e a ficha nao mostra o link. */
  guia: LinhaDoGuia[] | null;
};

type LinhaDoBanco = {
  slug: string;
  nome: string;
  descricao: string | null;
  guia_tamanhos: unknown;
  produto_variacoes: { tamanho: string | null; preco_centavos: number; ordem: number }[];
};

/**
 * Mapper explicito (#20). `id`, `ativo`, `produto_id` e `ordem` ficam de fora:
 * a vitrine nao mostra nenhum dos quatro, e `ordem` ja cumpriu o papel dela na
 * consulta.
 */
function mapeiaVitrine(linhas: LinhaDoBanco[]): ProdutoDaVitrine[] {
  return (
    linhas
      .map((l) => ({
        slug: l.slug,
        nome: l.nome,
        descricao: l.descricao,
        variacoes: l.produto_variacoes.map((v) => ({
          tamanho: v.tamanho,
          precoCentavos: v.preco_centavos,
        })),
        precoCentavos: Math.min(...l.produto_variacoes.map((v) => v.preco_centavos)),
        guia: leGuia(l.guia_tamanhos),
      }))
      // Produto sem variacao ativa nao tem preco, e `Math.min()` de lista vazia e
      // Infinity. Melhor sumir da vitrine do que aparecer por R$ Infinity.
      .filter((p) => p.variacoes.length > 0)
  );
}

/** O catalogo que a loja mostra. */
export async function vitrine(): Promise<ProdutoDaVitrine[]> {
  const supabase = await clienteServidor();

  const { data, error } = await supabase
    .from('produtos')
    // Colunas nomeadas. `estoque` nem aparece — o papel nao tem o GRANT, e
    // pedir coluna sem privilegio derruba a consulta inteira.
    .select(
      'slug, nome, descricao, guia_tamanhos, produto_variacoes(tamanho, preco_centavos, ordem)'
    )
    .order('slug')
    // P, M, G, GG. Por `tamanho` sairia G, GG, M, P.
    .order('ordem', { referencedTable: 'produto_variacoes', ascending: true });

  if (error || !data) return [];
  return mapeiaVitrine(data);
}

/** Onde entregar e por qual servico. So o CEP e a escolha: o preco e da cotacao. */
export type Entrega = { cep: string; servico: Servico };

type MotivoDoOrcamento =
  | MotivoDaRecusa
  | 'catalogo-indisponivel'
  | MotivoDoFrete
  /** A cotacao saiu, mas sem o servico escolhido para este CEP. */
  | 'frete-servico-indisponivel';

export type Orcamento =
  | {
      ok: true;
      linhas: LinhaPrecificada[];
      subtotalCentavos: number;
      /** Nulo enquanto nao ha onde entregar: o checkout antes do CEP. */
      frete: OpcaoDeFrete | null;
      totalCentavos: number;
    }
  | { ok: false; motivo: MotivoDoOrcamento };

type Carrinho =
  | { ok: true; linhas: LinhaPrecificada[]; subtotalCentavos: number; volumes: Volume[] }
  | { ok: false; motivo: MotivoDaRecusa | 'catalogo-indisponivel' };

/**
 * O carrinho precificado pelo banco, com as medidas que o frete pede.
 *
 * Esta e a unica leitura de preco do checkout, e ela nao recebe nem um numero
 * de dinheiro: entra `{slug, tamanho, quantidade}`, sai o valor. O preco e lido
 * do banco no momento do calculo, e o total volta a ser calculado do zero.
 */
async function leCarrinho(itens: ItemDoCarrinho[]): Promise<Carrinho> {
  if (itens.length === 0) return { ok: false, motivo: 'carrinho-vazio' };

  const slugs = [...new Set(itens.map((i) => i.slug))];
  const supabase = await clienteServidor();

  const { data, error } = await supabase
    .from('produtos')
    .select(
      'slug, nome, peso_gramas, altura_cm, largura_cm, comprimento_cm, produto_variacoes(tamanho, preco_centavos)'
    )
    // So os slugs pedidos. RLS e GRANT continuam valendo por cima disto.
    .in('slug', slugs);

  if (error || !data) return { ok: false, motivo: 'catalogo-indisponivel' };

  const catalogo: VariacaoDoBanco[] = data.flatMap((p) =>
    p.produto_variacoes.map((v) => ({
      slug: p.slug,
      nome: p.nome,
      tamanho: v.tamanho,
      precoCentavos: v.preco_centavos,
    }))
  );

  const preco = precifica(itens, catalogo);
  if (!preco.ok) return preco;

  const medidas = new Map(data.map((p) => [p.slug, p]));
  const volumes: Volume[] = preco.linhas.map((l) => {
    const m = medidas.get(l.produtoSlug);
    return {
      slug: l.produtoSlug,
      quantidade: l.quantidade,
      precoUnitarioCentavos: l.precoUnitarioCentavos,
      pesoGramas: m?.peso_gramas ?? null,
      alturaCm: m?.altura_cm ?? null,
      larguraCm: m?.largura_cm ?? null,
      comprimentoCm: m?.comprimento_cm ?? null,
    };
  });

  return { ok: true, linhas: preco.linhas, subtotalCentavos: preco.subtotalCentavos, volumes };
}

/**
 * Quanto custa este carrinho, segundo o banco.
 *
 * Sem `entrega`, o orcamento vem sem frete: e o checkout antes de a pessoa
 * dizer o CEP. Com `entrega`, o frete e cotado agora, e o servico escolhido
 * tem que estar entre os que a cotacao trouxe — escolher SEDEX para um CEP
 * que so tem PAC e recusa, nao troca.
 */
export async function orcamento(itens: ItemDoCarrinho[], entrega?: Entrega): Promise<Orcamento> {
  const carrinho = await leCarrinho(itens);
  if (!carrinho.ok) return carrinho;

  const { linhas, subtotalCentavos } = carrinho;
  if (!entrega)
    return { ok: true, linhas, subtotalCentavos, frete: null, totalCentavos: subtotalCentavos };

  const cotacao = await cotaFrete({ cep: entrega.cep, volumes: carrinho.volumes });
  if (!cotacao.ok) return cotacao;

  const frete = cotacao.opcoes.find((o) => o.servico === entrega.servico);
  if (!frete) return { ok: false, motivo: 'frete-servico-indisponivel' };

  return {
    ok: true,
    linhas,
    subtotalCentavos,
    frete,
    totalCentavos: subtotalCentavos + frete.precoCentavos,
  };
}

export type OpcoesDeFrete =
  | { ok: true; subtotalCentavos: number; opcoes: OpcaoDeFrete[] }
  | { ok: false; motivo: MotivoDaRecusa | 'catalogo-indisponivel' | MotivoDoFrete };

/** PAC e SEDEX para este carrinho e este CEP: o que a tela do checkout mostra. */
export async function opcoesDeFrete(itens: ItemDoCarrinho[], cep: string): Promise<OpcoesDeFrete> {
  const carrinho = await leCarrinho(itens);
  if (!carrinho.ok) return carrinho;

  const cotacao = await cotaFrete({ cep, volumes: carrinho.volumes });
  if (!cotacao.ok) return cotacao;

  return { ok: true, subtotalCentavos: carrinho.subtotalCentavos, opcoes: cotacao.opcoes };
}

/**
 * O guia de tamanhos de um produto (#206), para o checkout. A vitrine ja traz
 * o dela; o checkout le so o que precisa, e nao a vitrine inteira.
 */
export async function guiaDeTamanhos(slug: string): Promise<LinhaDoGuia[] | null> {
  const supabase = await clienteServidor();
  const { data, error } = await supabase
    .from('produtos')
    .select('guia_tamanhos')
    .eq('slug', slug)
    .maybeSingle();

  if (error || !data) return null;
  return leGuia(data.guia_tamanhos);
}
