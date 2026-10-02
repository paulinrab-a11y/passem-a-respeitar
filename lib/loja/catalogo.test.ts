import { beforeEach, describe, expect, it, vi } from 'vitest';
import { opcoesDeFrete, orcamento, vitrine } from './catalogo';
import type { ItemDoCarrinho } from './precos';

/**
 * O Supabase e trocado por um dublê: o que se testa aqui e a COSTURA —
 * `{slug, tamanho, quantidade}` entra, consulta sai, `precifica` roda, frete
 * entra, total sai. A consulta de verdade contra o banco esta conferida no PR,
 * e a RLS tem teste proprio em supabase/tests.
 */
vi.mock('@/lib/supabase/servidor', () => ({
  clienteServidor: vi.fn(),
}));
vi.mock('./frete', () => ({ cotaFrete: vi.fn() }));

const { clienteServidor } = await import('@/lib/supabase/servidor');
const { cotaFrete } = await import('./frete');

const PAC = { servico: 'pac', nome: 'PAC', precoCentavos: 2350, prazoDias: 8 } as const;
const SEDEX = { servico: 'sedex', nome: 'SEDEX', precoCentavos: 4590, prazoDias: 3 } as const;

/** Encadeamento do supabase-js: `.select().order().order()` e `.select().in()`. */
function bancoDevolve(resultado: { data: unknown; error: unknown }) {
  const elo: Record<string, unknown> = {};
  elo.select = () => elo;
  elo.order = () => elo;
  elo.in = () => Promise.resolve(resultado);
  // biome-ignore lint/suspicious/noThenProperty: o construtor de consulta do supabase-js E um thenable — e por isso que `await supabase.from(...).select(...)` funciona sem `.then()` explicito. O duble so imita isso; sem o `then` aqui, `vitrine()` receberia o proprio elo em vez do resultado.
  elo.then = (aceita: (v: unknown) => unknown) => Promise.resolve(resultado).then(aceita);

  vi.mocked(clienteServidor).mockResolvedValue({
    from: () => elo,
  } as unknown as Awaited<ReturnType<typeof clienteServidor>>);
}

const CAMISETA = {
  slug: 'camiseta-cbac',
  nome: 'Camiseta CBAC',
  descricao: 'Preta, oversized.',
  peso_gramas: 300,
  altura_cm: 4,
  largura_cm: 25,
  comprimento_cm: 30,
  produto_variacoes: [
    { tamanho: 'P', preco_centavos: 12000, ordem: 1 },
    { tamanho: 'M', preco_centavos: 12000, ordem: 2 },
    { tamanho: 'G', preco_centavos: 13000, ordem: 3 },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(cotaFrete).mockResolvedValue({ ok: true, opcoes: [PAC, SEDEX] });
});

describe('vitrine', () => {
  it('entrega o produto com as variacoes na ordem que o banco mandou', async () => {
    bancoDevolve({ data: [CAMISETA], error: null });

    const [produto] = await vitrine();

    expect(produto.nome).toBe('Camiseta CBAC');
    expect(produto.variacoes.map((v) => v.tamanho)).toEqual(['P', 'M', 'G']);
  });

  it('o preco da ficha e o menor entre as variacoes', async () => {
    bancoDevolve({ data: [CAMISETA], error: null });

    expect((await vitrine())[0].precoCentavos).toBe(12000);
  });

  // Produto sem variacao ativa nao tem preco: `Math.min()` de lista vazia e
  // Infinity, e "R$ Infinity" na vitrine e pior do que nao aparecer.
  it('produto sem variacao ativa some da vitrine', async () => {
    bancoDevolve({ data: [{ ...CAMISETA, produto_variacoes: [] }], error: null });

    expect(await vitrine()).toEqual([]);
  });

  // A home nao pode cair porque o catalogo caiu.
  it('erro de consulta devolve lista vazia', async () => {
    bancoDevolve({ data: null, error: { message: 'indisponivel' } });

    expect(await vitrine()).toEqual([]);
  });

  it('nao leva para a tela campo que a vitrine nao mostra', async () => {
    bancoDevolve({ data: [CAMISETA], error: null });

    const [produto] = await vitrine();

    expect(Object.keys(produto).sort()).toEqual([
      'descricao',
      'nome',
      'precoCentavos',
      'slug',
      'variacoes',
    ]);
    expect(Object.keys(produto.variacoes[0]).sort()).toEqual(['precoCentavos', 'tamanho']);
  });
});

describe('orcamento', () => {
  const pediu = (slug: string, tamanho: string | null, quantidade: number) =>
    [{ slug, tamanho, quantidade }] as ItemDoCarrinho[];

  it('cobra o preco do banco, nao o do pedido', async () => {
    bancoDevolve({ data: [CAMISETA], error: null });

    const adulterado = [
      { slug: 'camiseta-cbac', tamanho: 'M', quantidade: 2, precoCentavos: 100, total: 2 },
    ] as unknown as ItemDoCarrinho[];

    const r = await orcamento(adulterado);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.subtotalCentavos).toBe(24000);
    expect(r.totalCentavos).toBe(24000);
  });

  it('usa o preco da variacao pedida, nao o menor do produto', async () => {
    bancoDevolve({ data: [CAMISETA], error: null });

    const r = await orcamento(pediu('camiseta-cbac', 'G', 1));

    expect(r.ok && r.subtotalCentavos).toBe(13000);
  });

  // Antes do CEP nao ha frete, e nao ha consulta ao Melhor Envio (#199).
  it('sem entrega, vem sem frete e sem cotar', async () => {
    bancoDevolve({ data: [CAMISETA], error: null });

    const r = await orcamento(pediu('camiseta-cbac', 'M', 1));

    expect(r).toMatchObject({ ok: true, frete: null, totalCentavos: 12000 });
    expect(cotaFrete).not.toHaveBeenCalled();
  });

  it('com entrega, soma o frete do servico escolhido', async () => {
    bancoDevolve({ data: [CAMISETA], error: null });

    const pac = await orcamento(pediu('camiseta-cbac', 'M', 1), {
      cep: '01310100',
      servico: 'pac',
    });
    const sedex = await orcamento(pediu('camiseta-cbac', 'M', 1), {
      cep: '01310100',
      servico: 'sedex',
    });

    expect(pac).toMatchObject({ ok: true, frete: PAC, totalCentavos: 12000 + 2350 });
    expect(sedex).toMatchObject({ ok: true, frete: SEDEX, totalCentavos: 12000 + 4590 });
  });

  it('cota com o preco e as medidas do catalogo', async () => {
    bancoDevolve({ data: [CAMISETA], error: null });

    await orcamento(pediu('camiseta-cbac', 'G', 2), { cep: '01310100', servico: 'pac' });

    expect(vi.mocked(cotaFrete).mock.calls[0][0]).toEqual({
      cep: '01310100',
      volumes: [
        {
          slug: 'camiseta-cbac',
          quantidade: 2,
          precoUnitarioCentavos: 13000,
          pesoGramas: 300,
          alturaCm: 4,
          larguraCm: 25,
          comprimentoCm: 30,
        },
      ],
    });
  });

  it('produto sem medida no banco segue para a cotacao com nulos, e ela recusa', async () => {
    bancoDevolve({
      data: [
        { ...CAMISETA, peso_gramas: null, altura_cm: null, largura_cm: null, comprimento_cm: null },
      ],
      error: null,
    });
    vi.mocked(cotaFrete).mockResolvedValue({ ok: false, motivo: 'frete-sem-medida' });

    const r = await orcamento(pediu('camiseta-cbac', 'M', 1), { cep: '01310100', servico: 'pac' });

    expect(vi.mocked(cotaFrete).mock.calls[0][0].volumes[0].pesoGramas).toBeNull();
    expect(r).toEqual({ ok: false, motivo: 'frete-sem-medida' });
  });

  it('servico fora da cotacao recusa', async () => {
    bancoDevolve({ data: [CAMISETA], error: null });
    vi.mocked(cotaFrete).mockResolvedValue({ ok: true, opcoes: [PAC] });

    const r = await orcamento(pediu('camiseta-cbac', 'M', 1), {
      cep: '01310100',
      servico: 'sedex',
    });

    expect(r).toEqual({ ok: false, motivo: 'frete-servico-indisponivel' });
  });

  it('as opcoes do checkout trazem PAC, SEDEX e o subtotal', async () => {
    bancoDevolve({ data: [CAMISETA], error: null });

    expect(await opcoesDeFrete(pediu('camiseta-cbac', 'M', 1), '01310100')).toEqual({
      ok: true,
      subtotalCentavos: 12000,
      opcoes: [PAC, SEDEX],
    });
  });

  it('carrinho que o catalogo recusa nem chega a cotar', async () => {
    bancoDevolve({ data: [CAMISETA], error: null });

    const r = await opcoesDeFrete(pediu('camiseta-cbac', 'XG', 1), '01310100');

    expect(r.ok).toBe(false);
    expect(cotaFrete).not.toHaveBeenCalled();
  });

  it('carrinho vazio nem chega a consultar o banco', async () => {
    bancoDevolve({ data: [CAMISETA], error: null });

    expect(await orcamento([])).toEqual({ ok: false, motivo: 'carrinho-vazio' });
    expect(clienteServidor).not.toHaveBeenCalled();
  });

  it('catalogo fora do ar recusa em vez de cobrar errado', async () => {
    bancoDevolve({ data: null, error: { message: 'timeout' } });

    expect(await orcamento(pediu('camiseta-cbac', 'M', 1))).toEqual({
      ok: false,
      motivo: 'catalogo-indisponivel',
    });
  });

  // Produto inativo nao volta na consulta (a RLS corta), entao chega aqui como
  // lista vazia — a mesma resposta de produto inexistente.
  it('produto que o banco nao devolveu e indisponivel', async () => {
    bancoDevolve({ data: [], error: null });

    expect(await orcamento(pediu('camiseta-cbac', 'M', 1))).toEqual({
      ok: false,
      motivo: 'produto-indisponivel',
    });
  });

  it('tamanho que o produto nao tem e indisponivel', async () => {
    bancoDevolve({ data: [CAMISETA], error: null });

    expect(await orcamento(pediu('camiseta-cbac', 'GG', 1))).toEqual({
      ok: false,
      motivo: 'produto-indisponivel',
    });
  });

  it('a linha sai no formato que order_items grava', async () => {
    bancoDevolve({ data: [CAMISETA], error: null });

    const r = await orcamento(pediu('camiseta-cbac', 'M', 2));

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.linhas[0]).toEqual({
      produtoSlug: 'camiseta-cbac',
      nome: 'Camiseta CBAC',
      tamanho: 'M',
      quantidade: 2,
      precoUnitarioCentavos: 12000,
      subtotalCentavos: 24000,
    });
  });
});
