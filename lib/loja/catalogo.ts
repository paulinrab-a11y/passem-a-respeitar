import 'server-only';

/**
 * Leitura do catalogo (Issue #99).
 *
 * Duas funcoes, dois publicos:
 *
 *   `vitrine()`   — o que a home mostra
 *   `orcamento()` — o que o checkout cobra
 *
 * As duas leem a MESMA tabela. Nao ha um preco "de exibicao" e outro "de
 * cobranca": se divergissem, a pessoa veria um numero e pagaria outro, e a
 * divergencia so apareceria no extrato dela.
 *
 * O client aqui e o publishable, igual ao do navegador. Nao e descuido: o
 * catalogo e publico, e a RLS ja limita as linhas as ativas e o GRANT ja limita
 * as colunas. `estoque` nao esta concedido para este papel e por isso nao e
 * lido aqui — quem vai precisar do numero e a criacao do pedido da #100, com a
 * chave secreta.
 */

import { calculaFrete } from '@/lib/loja/frete';
import {
  type ItemDoCarrinho,
  type LinhaPrecificada,
  type MotivoDaRecusa,
  pecasDe,
  precifica,
  type VariacaoDoBanco,
} from '@/lib/loja/precos';
import { clienteServidor } from '@/lib/supabase/servidor';

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
};

type LinhaDoBanco = {
  slug: string;
  nome: string;
  descricao: string | null;
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
    .select('slug, nome, descricao, produto_variacoes(tamanho, preco_centavos, ordem)')
    .order('slug')
    // P, M, G, GG. Por `tamanho` sairia G, GG, M, P.
    .order('ordem', { referencedTable: 'produto_variacoes', ascending: true });

  if (error || !data) return [];
  return mapeiaVitrine(data);
}

export type Orcamento =
  | {
      ok: true;
      linhas: LinhaPrecificada[];
      subtotalCentavos: number;
      freteCentavos: number;
      totalCentavos: number;
    }
  | { ok: false; motivo: MotivoDaRecusa | 'catalogo-indisponivel' };

/**
 * Quanto custa este carrinho, segundo o banco.
 *
 * Esta e a funcao que o checkout chama, e ela nao recebe nem um numero de
 * dinheiro: entra `{slug, tamanho, quantidade}`, sai o valor. O preco e lido do
 * banco no momento do calculo, e o total volta a ser calculado do zero.
 *
 * O frete vem do `calculaFrete`, que hoje devolve zero — e devolve de um lugar
 * so, para a politica poder mudar sem passar por aqui.
 */
export async function orcamento(itens: ItemDoCarrinho[], cep?: string | null): Promise<Orcamento> {
  if (itens.length === 0) return { ok: false, motivo: 'carrinho-vazio' };

  const slugs = [...new Set(itens.map((i) => i.slug))];
  const supabase = await clienteServidor();

  const { data, error } = await supabase
    .from('produtos')
    .select('slug, nome, produto_variacoes(tamanho, preco_centavos)')
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

  const freteCentavos = await calculaFrete({
    subtotalCentavos: preco.subtotalCentavos,
    cep,
    pecas: pecasDe(preco.linhas),
  });

  return {
    ok: true,
    linhas: preco.linhas,
    subtotalCentavos: preco.subtotalCentavos,
    freteCentavos,
    totalCentavos: preco.subtotalCentavos + freteCentavos,
  };
}
