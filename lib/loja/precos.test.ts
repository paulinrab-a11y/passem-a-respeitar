import { describe, expect, it } from 'vitest';
import {
  esquemaCarrinho,
  esquemaItemDoCarrinho,
  type ItemDoCarrinho,
  pecasDe,
  precifica,
  precoNaFicha,
  type VariacaoDoBanco,
} from './precos';

/** O catalogo como o banco entrega: camiseta a R$ 120,00 em quatro tamanhos. */
const CATALOGO: VariacaoDoBanco[] = ['P', 'M', 'G', 'GG'].map((tamanho) => ({
  slug: 'camiseta-cbac',
  nome: 'Camiseta CBAC x Passem a Respeitar',
  tamanho,
  precoCentavos: 12000,
}));

const ADESIVO: VariacaoDoBanco = {
  slug: 'adesivo-par',
  nome: 'Adesivo P.A.R',
  tamanho: null,
  precoCentavos: 500,
};

function item(slug: string, tamanho: string | null, quantidade: number): ItemDoCarrinho {
  return { slug, tamanho, quantidade } as ItemDoCarrinho;
}

const ok = (r: ReturnType<typeof precifica>) => {
  if (!r.ok) throw new Error(`esperava sucesso, veio ${r.motivo}`);
  return r;
};

describe('o preco nunca vem do navegador', () => {
  // ESTE e o teste da #99. O resto do arquivo apoia este.
  it('ignora preco adulterado no corpo do pedido', () => {
    const adulterado = [
      {
        slug: 'camiseta-cbac',
        tamanho: 'M',
        quantidade: 1,
        // Tudo isto chega do DevTools de quem quer pagar R$ 1,00.
        preco: 1,
        precoCentavos: 100,
        preco_unitario_centavos: 100,
        subtotal: 1,
        subtotalCentavos: 100,
        total: 1,
        totalCentavos: 100,
        desconto: 11900,
      },
    ] as unknown as ItemDoCarrinho[];

    const r = ok(precifica(adulterado, CATALOGO));

    expect(r.subtotalCentavos).toBe(12000);
    expect(r.linhas[0].precoUnitarioCentavos).toBe(12000);
    expect(r.linhas[0].subtotalCentavos).toBe(12000);
  });

  // A garantia nao e um `if` que compara: e o resultado nao ter por onde
  // carregar o numero do cliente.
  it('a linha devolvida so tem os campos declarados', () => {
    const r = ok(precifica([item('camiseta-cbac', 'M', 1)], CATALOGO));

    expect(Object.keys(r.linhas[0]).sort()).toEqual([
      'nome',
      'precoUnitarioCentavos',
      'produtoSlug',
      'quantidade',
      'subtotalCentavos',
      'tamanho',
    ]);
  });

  // O nome tambem vem do banco: senao o pedido gravaria "Camiseta gratis" no
  // historico e ninguem entenderia depois.
  it('o nome vem do catalogo, nao do pedido', () => {
    const comNome = [
      { slug: 'camiseta-cbac', tamanho: 'M', quantidade: 1, nome: 'Camiseta de graça' },
    ] as unknown as ItemDoCarrinho[];

    expect(ok(precifica(comNome, CATALOGO)).linhas[0].nome).toBe(
      'Camiseta CBAC x Passem a Respeitar'
    );
  });

  it('o schema descarta o preco antes de o objeto seguir adiante', () => {
    const analisado = esquemaItemDoCarrinho.parse({
      slug: 'camiseta-cbac',
      tamanho: 'M',
      quantidade: 2,
      preco: 1,
      precoCentavos: 100,
    });

    expect(Object.keys(analisado).sort()).toEqual(['quantidade', 'slug', 'tamanho']);
  });
});

describe('precifica', () => {
  it('calcula preco x quantidade', () => {
    const r = ok(precifica([item('camiseta-cbac', 'M', 2)], CATALOGO));

    expect(r.linhas[0].subtotalCentavos).toBe(24000);
    expect(r.subtotalCentavos).toBe(24000);
  });

  it('soma varias linhas', () => {
    const r = ok(
      precifica(
        [
          item('camiseta-cbac', 'M', 2),
          item('camiseta-cbac', 'GG', 1),
          item('adesivo-par', null, 3),
        ],
        [...CATALOGO, ADESIVO]
      )
    );

    // 2x120 + 1x120 + 3x5
    expect(r.subtotalCentavos).toBe(37500);
    expect(r.linhas).toHaveLength(3);
  });

  it('aceita produto sem tamanho', () => {
    const r = ok(precifica([item('adesivo-par', null, 1)], [ADESIVO]));
    expect(r.linhas[0].tamanho).toBeNull();
    expect(r.subtotalCentavos).toBe(500);
  });

  it('os nomes dos campos batem com as colunas de order_items', () => {
    const r = ok(precifica([item('camiseta-cbac', 'M', 1)], CATALOGO));
    const linha = r.linhas[0];

    // O snapshot do pedido e copia direta disto.
    expect(linha.produtoSlug).toBe('camiseta-cbac');
    expect(linha.precoUnitarioCentavos).toBe(12000);
    expect(linha.quantidade).toBe(1);
  });
});

describe('recusa', () => {
  it('carrinho vazio', () => {
    expect(precifica([], CATALOGO)).toEqual({ ok: false, motivo: 'carrinho-vazio' });
  });

  it('carrinho com linhas demais', () => {
    const muitos = Array.from({ length: 21 }, (_, i) => item(`produto-${i}`, null, 1));
    expect(precifica(muitos, CATALOGO)).toEqual({ ok: false, motivo: 'carrinho-grande-demais' });
  });

  it('produto que nao existe', () => {
    expect(precifica([item('boné-pirata', null, 1)], CATALOGO)).toEqual({
      ok: false,
      motivo: 'produto-indisponivel',
    });
  });

  // Produto inativo nao chega no catalogo — a RLS ja cortou na consulta. Da na
  // mesma resposta que "nao existe", e isso e de proposito.
  it('produto desativado responde igual a produto inexistente', () => {
    expect(precifica([item('camiseta-cbac', 'M', 1)], [])).toEqual({
      ok: false,
      motivo: 'produto-indisponivel',
    });
  });

  it('tamanho que o produto nao tem', () => {
    expect(precifica([item('camiseta-cbac', 'XGG', 1)], CATALOGO)).toEqual({
      ok: false,
      motivo: 'produto-indisponivel',
    });
  });

  it('nao confunde produto sem tamanho com produto com tamanho', () => {
    expect(precifica([item('camiseta-cbac', null, 1)], CATALOGO)).toEqual({
      ok: false,
      motivo: 'produto-indisponivel',
    });
  });

  it.each([
    ['zero', 0],
    ['negativa', -3],
    ['fracionaria', 1.5],
    ['acima do limite', 11],
  ])('quantidade %s', (_caso, quantidade) => {
    expect(precifica([item('camiseta-cbac', 'M', quantidade)], CATALOGO)).toEqual({
      ok: false,
      motivo: 'quantidade-invalida',
    });
  });

  it('preco zerado no catalogo e tratado como indisponivel', () => {
    const quebrado = [{ ...CATALOGO[1], precoCentavos: 0 }];
    expect(precifica([item('camiseta-cbac', 'M', 1)], quebrado)).toEqual({
      ok: false,
      motivo: 'produto-indisponivel',
    });
  });

  it('carrinho grande demais em valor', () => {
    const caro = [{ ...CATALOGO[1], precoCentavos: 2_000_000 }];
    expect(precifica([item('camiseta-cbac', 'M', 6)], caro)).toEqual({
      ok: false,
      motivo: 'valor-alto-demais',
    });
  });

  // Chave vinda de fora nao pode achar propriedade herdada do prototipo.
  it('nao se confunde com nome de metodo de Object', () => {
    expect(precifica([item('constructor', null, 1)], CATALOGO)).toEqual({
      ok: false,
      motivo: 'produto-indisponivel',
    });
  });
});

describe('linhas repetidas', () => {
  // Sem juntar antes de conferir, o limite de 10 por item nao vale nada:
  // cinco linhas de 10 da mesma camiseta levariam 50 pecas.
  it('cinco linhas de 10 da mesma variacao sao recusadas', () => {
    const burla = Array.from({ length: 5 }, () => item('camiseta-cbac', 'M', 10));

    expect(precifica(burla, CATALOGO)).toEqual({ ok: false, motivo: 'quantidade-invalida' });
  });

  it('linhas repetidas viram uma linha só', () => {
    const r = ok(
      precifica([item('camiseta-cbac', 'M', 2), item('camiseta-cbac', 'M', 3)], CATALOGO)
    );

    expect(r.linhas).toHaveLength(1);
    expect(r.linhas[0].quantidade).toBe(5);
    expect(r.subtotalCentavos).toBe(60000);
  });

  it('tamanhos diferentes continuam linhas diferentes', () => {
    const r = ok(
      precifica([item('camiseta-cbac', 'M', 2), item('camiseta-cbac', 'G', 2)], CATALOGO)
    );

    expect(r.linhas).toHaveLength(2);
  });

  it('nao muda o array que recebeu', () => {
    const itens = [item('camiseta-cbac', 'M', 2), item('camiseta-cbac', 'M', 3)];
    const copia = itens.map((i) => ({ ...i }));

    precifica(itens, CATALOGO);

    expect(itens).toEqual(copia);
  });
});

describe('esquemaCarrinho', () => {
  it('aceita um carrinho normal', () => {
    const r = esquemaCarrinho.safeParse({
      itens: [{ slug: 'camiseta-cbac', tamanho: 'M', quantidade: 2 }],
    });
    expect(r.success).toBe(true);
  });

  it('assume tamanho nulo quando a chave nem vem', () => {
    expect(esquemaItemDoCarrinho.parse({ slug: 'adesivo-par', quantidade: 1 }).tamanho).toBeNull();
  });

  it.each([
    ['slug com maiuscula', { slug: 'Camiseta', quantidade: 1 }],
    ['slug com barra', { slug: '../etc/passwd', quantidade: 1 }],
    ['slug vazio', { slug: '', quantidade: 1 }],
    ['tamanho inventado', { slug: 'camiseta-cbac', tamanho: 'XXG', quantidade: 1 }],
    ['quantidade em texto', { slug: 'camiseta-cbac', quantidade: '2' }],
    ['quantidade zero', { slug: 'camiseta-cbac', quantidade: 0 }],
    ['quantidade gigante', { slug: 'camiseta-cbac', quantidade: 999 }],
  ])('recusa %s', (_caso, bruto) => {
    expect(esquemaItemDoCarrinho.safeParse(bruto).success).toBe(false);
  });

  it('recusa carrinho vazio e carrinho grande demais', () => {
    expect(esquemaCarrinho.safeParse({ itens: [] }).success).toBe(false);

    const muitos = Array.from({ length: 21 }, () => ({ slug: 'camiseta-cbac', quantidade: 1 }));
    expect(esquemaCarrinho.safeParse({ itens: muitos }).success).toBe(false);
  });
});

describe('pecasDe', () => {
  it('soma as quantidades', () => {
    const r = ok(
      precifica([item('camiseta-cbac', 'M', 2), item('camiseta-cbac', 'G', 3)], CATALOGO)
    );
    expect(pecasDe(r.linhas)).toBe(5);
  });

  it('carrinho sem linha da zero', () => {
    expect(pecasDe([])).toBe(0);
  });
});

describe('precoNaFicha', () => {
  it.each([
    [12000, '120'],
    [500, '5'],
    [12050, '120,50'],
    [1, '0,01'],
    [999999, '9999,99'],
  ])('%i centavos vira %s', (centavos, esperado) => {
    expect(precoNaFicha(centavos)).toBe(esperado);
  });
});
