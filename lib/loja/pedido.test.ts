import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Supabase trocado por dublê nos dois lados. O que se prova aqui e o caminho
 * inteiro: corpo do request entra, catalogo responde, e o que chega no banco e
 * o valor do CATALOGO — nunca o que veio no corpo.
 *
 * As barreiras do banco (RLS, GRANT, quem pode executar `cria_pedido`) estao
 * conferidas contra o Supabase real e anotadas no PR.
 */
vi.mock('@/lib/supabase/servidor', () => ({
  usuarioDaSessao: vi.fn(),
  clienteServidor: vi.fn(),
}));
vi.mock('@/lib/supabase/admin', () => ({ clienteAdmin: vi.fn() }));
// O Melhor Envio tambem e dublê (#199). A cotacao tem teste proprio, em
// frete.test.ts; aqui o que importa e o que a criacao faz com ela.
vi.mock('./frete', async (original) => ({
  ...(await original<typeof import('./frete')>()),
  cotaFrete: vi.fn(),
}));

const { usuarioDaSessao, clienteServidor } = await import('@/lib/supabase/servidor');
const { clienteAdmin } = await import('@/lib/supabase/admin');
const { cotaFrete } = await import('./frete');
const { criaPedido } = await import('./pedido');

const PAC = { servico: 'pac', nome: 'PAC', precoCentavos: 2350, prazoDias: 8 } as const;
const SEDEX = { servico: 'sedex', nome: 'SEDEX', precoCentavos: 4590, prazoDias: 3 } as const;

const USUARIO = { id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', email: 'quem@exemplo.test' };

const CATALOGO = {
  slug: 'camiseta-cbac',
  nome: 'Camiseta CBAC',
  peso_gramas: 300,
  altura_cm: 4,
  largura_cm: 25,
  comprimento_cm: 30,
  produto_variacoes: [
    { tamanho: 'P', preco_centavos: 12000, ordem: 1 },
    { tamanho: 'M', preco_centavos: 12000, ordem: 2 },
  ],
};

const ENDERECO = {
  nome: 'Fulano de Teste',
  cep: '01310-100',
  logradouro: 'Avenida Paulista',
  numero: '1578',
  complemento: 'apto 92',
  bairro: 'Bela Vista',
  cidade: 'São Paulo',
  uf: 'SP',
};

/** O que a funcao do banco recebeu. E aqui que se confere o que foi gravado. */
let gravado: Record<string, unknown> | null = null;

type ItemGravado = {
  produto_slug: string;
  nome: string;
  tamanho: string | null;
  quantidade: number;
  preco_unitario_centavos: number;
};

/** Explode com mensagem legivel quando nada foi gravado, em vez de TypeError. */
function itensGravados(): ItemGravado[] {
  if (!gravado) throw new Error('esperava gravacao, e nada foi gravado');
  return gravado.p_itens as ItemGravado[];
}

function enderecoGravado(): Record<string, string | null> {
  if (!gravado) throw new Error('esperava gravacao, e nada foi gravado');
  return gravado.p_endereco as Record<string, string | null>;
}

function bancoComCatalogo(produtos: unknown[] = [CATALOGO], erroNaGravacao = false) {
  const elo: Record<string, unknown> = {};
  elo.select = () => elo;
  elo.order = () => elo;
  elo.in = () => Promise.resolve({ data: produtos, error: null });
  vi.mocked(clienteServidor).mockResolvedValue({ from: () => elo } as never);

  vi.mocked(clienteAdmin).mockReturnValue({
    rpc: (_nome: string, args: Record<string, unknown>) => {
      gravado = args;
      return Promise.resolve(
        erroNaGravacao
          ? { data: null, error: { message: 'caiu' } }
          : { data: [{ pedido_id: 'ped-1', pedido_numero: 42 }], error: null }
      );
    },
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  gravado = null;
  vi.mocked(usuarioDaSessao).mockResolvedValue(USUARIO as never);
  vi.mocked(cotaFrete).mockResolvedValue({ ok: true, opcoes: [PAC, SEDEX] });
  bancoComCatalogo();
});

const pedido = (extra: Record<string, unknown> = {}) => ({
  itens: [{ slug: 'camiseta-cbac', tamanho: 'M', quantidade: 2 }],
  endereco: ENDERECO,
  servico: 'pac',
  ...extra,
});

describe('o corpo do request nao define dinheiro', () => {
  // O teste central da #104.
  it('ignora preco e total adulterados e grava o valor do catalogo', async () => {
    const adulterado = {
      itens: [
        {
          slug: 'camiseta-cbac',
          tamanho: 'M',
          quantidade: 2,
          preco: 1,
          precoCentavos: 100,
          preco_unitario_centavos: 100,
        },
      ],
      endereco: ENDERECO,
      servico: 'pac',
      total: 1,
      totalCentavos: 100,
      subtotal: 1,
      frete: -50000,
      freteCentavos: 0,
      p_frete: { centavos: 0, servico: 'pac', prazo_dias: 1 },
      desconto: 23900,
    };

    const r = await criaPedido(adulterado);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // 2 x 120,00 do catalogo, mais o PAC da cotacao.
    expect(r.totalCentavos).toBe(24000 + 2350);
    expect(gravado?.p_total_centavos).toBe(24000 + 2350);
    expect(gravado?.p_frete).toEqual({ centavos: 2350, servico: 'pac', prazo_dias: 8 });
    expect(itensGravados()[0].preco_unitario_centavos).toBe(12000);
  });

  it('ignora user_id vindo no corpo e usa o da sessao', async () => {
    await criaPedido(pedido({ user_id: 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb' }));

    expect(gravado?.p_user_id).toBe(USUARIO.id);
  });

  it('ignora status e numero vindos no corpo', async () => {
    await criaPedido(pedido({ status: 'pago', numero: 1, anonimizado_em: null }));

    expect(Object.keys(gravado ?? {}).sort()).toEqual([
      'p_endereco',
      'p_frete',
      'p_itens',
      'p_total_centavos',
      'p_user_id',
    ]);
  });

  it('o nome do item vem do catalogo, nao do corpo', async () => {
    await criaPedido({
      itens: [{ slug: 'camiseta-cbac', tamanho: 'M', quantidade: 1, nome: 'Camiseta de graça' }],
      endereco: ENDERECO,
      servico: 'pac',
    });

    expect(itensGravados()[0].nome).toBe('Camiseta CBAC');
  });
});

describe('snapshot', () => {
  it('grava os campos que order_items espera', async () => {
    await criaPedido(pedido());

    expect(itensGravados()[0]).toEqual({
      produto_slug: 'camiseta-cbac',
      nome: 'Camiseta CBAC',
      tamanho: 'M',
      quantidade: 2,
      preco_unitario_centavos: 12000,
    });
  });

  // O motivo de `order_items` existir: preco novo no catalogo nao mexe em
  // pedido antigo, porque o pedido guarda copia propria.
  it('o preco gravado e o de agora, e o catalogo mudar depois nao o alcanca', async () => {
    await criaPedido(pedido());
    const primeiro = itensGravados()[0].preco_unitario_centavos;

    // A loja aumenta o preco.
    bancoComCatalogo([
      {
        ...CATALOGO,
        produto_variacoes: [{ tamanho: 'M', preco_centavos: 19900, ordem: 2 }],
      },
    ]);
    await criaPedido(pedido());
    const segundo = itensGravados()[0].preco_unitario_centavos;

    expect(primeiro).toBe(12000);
    expect(segundo).toBe(19900);
  });
});

describe('frete (#199)', () => {
  it('cota para o CEP do endereco, com as medidas do catalogo', async () => {
    await criaPedido(pedido());

    expect(cotaFrete).toHaveBeenCalledTimes(1);
    expect(vi.mocked(cotaFrete).mock.calls[0][0]).toEqual({
      cep: '01310100',
      volumes: [
        {
          slug: 'camiseta-cbac',
          quantidade: 2,
          precoUnitarioCentavos: 12000,
          pesoGramas: 300,
          alturaCm: 4,
          larguraCm: 25,
          comprimentoCm: 30,
        },
      ],
    });
  });

  it('o servico escolhido decide qual preco entra', async () => {
    const r = await criaPedido(pedido({ servico: 'sedex' }));

    expect(r.ok && r.totalCentavos).toBe(24000 + 4590);
    expect(gravado?.p_frete).toEqual({ centavos: 4590, servico: 'sedex', prazo_dias: 3 });
  });

  it.each([
    ['ausente', undefined],
    ['inventado', 'jato-particular'],
    ['em maiuscula', 'PAC'],
    ['numero', 1],
  ])('servico %s recusa antes de cotar', async (_, servico) => {
    const r = await criaPedido(pedido({ servico }));

    expect(r).toEqual({ ok: false, motivo: 'entrada-invalida' });
    expect(cotaFrete).not.toHaveBeenCalled();
    expect(gravado).toBeNull();
  });

  it('servico que a cotacao nao trouxe recusa: nao troca pelo outro', async () => {
    vi.mocked(cotaFrete).mockResolvedValue({ ok: true, opcoes: [PAC] });

    const r = await criaPedido(pedido({ servico: 'sedex' }));

    expect(r).toEqual({ ok: false, motivo: 'frete-servico-indisponivel' });
    expect(gravado).toBeNull();
  });

  it.each([
    'frete-fora-do-ar',
    'frete-sem-configuracao',
    'frete-sem-medida',
    'frete-cep-invalido',
    'frete-sem-servico',
  ] as const)('sem cotacao (%s) nao ha pedido, nem de frete zero', async (motivo) => {
    vi.mocked(cotaFrete).mockResolvedValue({ ok: false, motivo });

    const r = await criaPedido(pedido());

    expect(r).toEqual({ ok: false, motivo });
    expect(gravado).toBeNull();
  });

  it('produto indisponivel nem chega a cotar: e consulta paga a toa', async () => {
    bancoComCatalogo([]);

    await criaPedido(pedido());

    expect(cotaFrete).not.toHaveBeenCalled();
  });
});

describe('endereco', () => {
  it('chega no banco normalizado e com nome de coluna', async () => {
    await criaPedido(pedido());

    expect(gravado?.p_endereco).toEqual({
      entrega_nome: 'Fulano de Teste',
      entrega_cep: '01310100',
      entrega_logradouro: 'Avenida Paulista',
      entrega_numero: '1578',
      entrega_complemento: 'apto 92',
      entrega_bairro: 'Bela Vista',
      entrega_cidade: 'São Paulo',
      entrega_uf: 'SP',
    });
  });

  it('UF em minuscula sobe maiuscula', async () => {
    await criaPedido(pedido({ endereco: { ...ENDERECO, uf: 'rj' } }));

    expect(enderecoGravado().entrega_uf).toBe('RJ');
  });

  it.each([
    ['UF inexistente', { uf: 'XX' }],
    ['CEP curto', { cep: '123' }],
    ['sem numero', { numero: '' }],
    ['sem destinatario', { nome: '' }],
  ])('recusa %s sem gravar nada', async (_caso, campo) => {
    const r = await criaPedido(pedido({ endereco: { ...ENDERECO, ...campo } }));

    expect(r).toEqual({ ok: false, motivo: 'entrada-invalida' });
    expect(gravado).toBeNull();
  });
});

describe('recusa', () => {
  it('sem sessao nao grava nada', async () => {
    vi.mocked(usuarioDaSessao).mockResolvedValue(null);

    expect(await criaPedido(pedido())).toEqual({ ok: false, motivo: 'sem-sessao' });
    expect(gravado).toBeNull();
  });

  it('sem sessao nem chega a consultar o catalogo', async () => {
    vi.mocked(usuarioDaSessao).mockResolvedValue(null);
    await criaPedido(pedido());

    expect(clienteServidor).not.toHaveBeenCalled();
  });

  it.each([
    ['corpo vazio', {}],
    ['carrinho vazio', { itens: [], endereco: ENDERECO }],
    ['sem endereco', { itens: [{ slug: 'camiseta-cbac', quantidade: 1 }] }],
    ['quantidade zero', { itens: [{ slug: 'camiseta-cbac', quantidade: 0 }], endereco: ENDERECO }],
    ['quantidade acima do limite', { itens: [{ slug: 'x', quantidade: 99 }], endereco: ENDERECO }],
    ['slug invalido', { itens: [{ slug: '../etc', quantidade: 1 }], endereco: ENDERECO }],
    [
      'tamanho inventado',
      { itens: [{ slug: 'x', tamanho: 'XXG', quantidade: 1 }], endereco: ENDERECO },
    ],
    ['nao e objeto', 'compra tudo'],
    ['nulo', null],
  ])('recusa %s', async (_caso, bruto) => {
    const r = await criaPedido(bruto);

    expect(r).toEqual({ ok: false, motivo: 'entrada-invalida' });
    expect(gravado).toBeNull();
  });

  // Produto desativado nao volta da consulta — a RLS ja cortou. Da na mesma
  // resposta que produto inexistente, de proposito.
  it('produto indisponivel recusa antes de gravar', async () => {
    bancoComCatalogo([]);

    const r = await criaPedido(pedido());

    expect(r).toEqual({ ok: false, motivo: 'produto-indisponivel' });
    expect(gravado).toBeNull();
  });

  it('tamanho que o produto nao tem recusa antes de gravar', async () => {
    const r = await criaPedido({
      itens: [{ slug: 'camiseta-cbac', tamanho: 'GG', quantidade: 1 }],
      endereco: ENDERECO,
      servico: 'pac',
    });

    expect(r).toEqual({ ok: false, motivo: 'produto-indisponivel' });
    expect(gravado).toBeNull();
  });

  it('falha na gravacao nao vira pedido pela metade', async () => {
    bancoComCatalogo([CATALOGO], true);

    expect(await criaPedido(pedido())).toEqual({ ok: false, motivo: 'nao-consegui-gravar' });
  });
});

describe('resposta', () => {
  it('devolve o que a tela precisa e nada do banco', async () => {
    const r = await criaPedido(pedido());

    // O total com o frete: e o que a tela de pagamento cobra.
    expect(r).toEqual({ ok: true, id: 'ped-1', numero: 42, totalCentavos: 24000 + 2350 });
  });
});
