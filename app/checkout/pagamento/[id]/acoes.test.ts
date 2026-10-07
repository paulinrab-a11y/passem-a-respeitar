import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A pergunta da tela do Pix (#250): o pedido ainda espera pagamento?
 *
 * O que se prova e quem responde e com que caminho. O banco e um duble que
 * anota os filtros, a conciliacao com o Mercado Pago e outro duble, e o
 * limite de taxa roda de verdade, na memoria.
 */
vi.mock('@/lib/supabase/servidor', () => ({ usuarioDaSessao: vi.fn(), clienteServidor: vi.fn() }));
vi.mock('@/lib/loja/conciliacao', () => ({ conciliaPedido: vi.fn() }));

const { usuarioDaSessao, clienteServidor } = await import('@/lib/supabase/servidor');
const { conciliaPedido } = await import('@/lib/loja/conciliacao');
const { conferePagamento } = await import('./acoes');

const PEDIDO = '33333333-3333-4333-8333-333333333333';

/** O status que o banco devolve a cada leitura, em ordem. `null` e "nao achei". */
let leituras: (string | null)[] = [];
let filtros: unknown[][] = [];
let colunas: string[] = [];
let erroDoBanco = false;

let pessoa = 0;
/** Uma pessoa nova por teste: o limite da memoria nao vaza de um para outro. */
function entra() {
  pessoa += 1;
  vi.mocked(usuarioDaSessao).mockResolvedValue({
    id: `pessoa-${pessoa}`,
    email: 'pessoa@exemplo.test',
  } as never);
}

beforeEach(() => {
  leituras = ['aguardando_pagamento'];
  filtros = [];
  colunas = [];
  erroDoBanco = false;
  vi.mocked(conciliaPedido).mockReset().mockResolvedValue(false);
  vi.mocked(clienteServidor).mockResolvedValue({
    from(tabela: string) {
      const elo = {
        select(c: string) {
          colunas.push(`${tabela}:${c}`);
          return elo;
        },
        eq(...args: unknown[]) {
          filtros.push(args);
          return elo;
        },
        async maybeSingle() {
          if (erroDoBanco) return { data: null, error: { message: 'caiu' } };
          const status = leituras.length > 1 ? leituras.shift() : leituras[0];
          return { data: status ? { status } : null, error: null };
        },
      };
      return elo;
    },
  } as never);
  entra();
});

describe('o que entra', () => {
  it.each([
    ['vazio', ''],
    ['nao uuid', 'pedido-1'],
    ['objeto', { id: PEDIDO }],
    ['nada', undefined],
  ])('id %s nem chega ao banco', async (_nome, bruto) => {
    expect(await conferePagamento(bruto)).toBe('falhou');
    expect(clienteServidor).not.toHaveBeenCalled();
  });

  it('sem sessao nao consulta nada', async () => {
    vi.mocked(usuarioDaSessao).mockResolvedValue(null);

    expect(await conferePagamento(PEDIDO)).toBe('sem-sessao');
    expect(colunas).toEqual([]);
  });
});

describe('a consulta', () => {
  it('le so o status, filtrado pelo id E pelo dono da sessao', async () => {
    await conferePagamento(PEDIDO);

    expect(colunas).toEqual(['orders:status']);
    expect(filtros).toEqual([
      ['id', PEDIDO],
      ['user_id', `pessoa-${pessoa}`],
    ]);
  });

  // Inexistente, de outra pessoa e banco fora respondem igual: a resposta
  // nao conta a quem chuta ids se o pedido existe.
  it('pedido que a consulta nao acha e falha, sem conciliar', async () => {
    leituras = [null];

    expect(await conferePagamento(PEDIDO)).toBe('falhou');
    expect(conciliaPedido).not.toHaveBeenCalled();
  });

  it('erro do banco e a mesma falha', async () => {
    erroDoBanco = true;

    expect(await conferePagamento(PEDIDO)).toBe('falhou');
    expect(conciliaPedido).not.toHaveBeenCalled();
  });
});

describe('a resposta', () => {
  it.each(['pago', 'cancelado', 'em_producao'])(
    'pedido %s ja saiu da espera: mudou, sem perguntar ao provedor',
    async (status) => {
      leituras = [status];

      expect(await conferePagamento(PEDIDO)).toBe('mudou');
      expect(conciliaPedido).not.toHaveBeenCalled();
    }
  );

  it('ainda esperando e o provedor sem novidade: aguardando', async () => {
    expect(await conferePagamento(PEDIDO)).toBe('aguardando');
    expect(conciliaPedido).toHaveBeenCalledWith(PEDIDO);
  });

  // O webhook atrasou e a conciliacao achou o pagamento: a tela vai ao pedido
  // agora, e nao na proxima volta do relogio.
  it('a conciliacao achou o pagamento: mudou', async () => {
    leituras = ['aguardando_pagamento', 'pago'];
    vi.mocked(conciliaPedido).mockResolvedValue(true);

    expect(await conferePagamento(PEDIDO)).toBe('mudou');
  });

  // A conciliacao diz "mudou alguma tentativa" — um Pix que venceu, por
  // exemplo. O pedido continua esperando, e a tela tambem.
  it('a conciliacao mudou uma tentativa mas o pedido segue esperando: aguardando', async () => {
    leituras = ['aguardando_pagamento', 'aguardando_pagamento'];
    vi.mocked(conciliaPedido).mockResolvedValue(true);

    expect(await conferePagamento(PEDIDO)).toBe('aguardando');
  });

  it('a resposta e so a palavra, sem nada do pedido', async () => {
    expect(await conferePagamento(PEDIDO)).toBeTypeOf('string');
  });
});

describe('limite', () => {
  it('a vigesima primeira no mesmo minuto nao chega ao banco', async () => {
    for (let i = 0; i < 20; i += 1) {
      expect(await conferePagamento(PEDIDO)).toBe('aguardando');
    }
    colunas = [];

    expect(await conferePagamento(PEDIDO)).toBe('limite');
    expect(colunas).toEqual([]);
  });

  it('o limite e por pessoa: a outra continua conferindo', async () => {
    for (let i = 0; i < 21; i += 1) await conferePagamento(PEDIDO);
    entra();

    expect(await conferePagamento(PEDIDO)).toBe('aguardando');
  });
});
