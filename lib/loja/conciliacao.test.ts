import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A conciliacao nao decide nada sozinha: ela reusa `confirmaPeloProvedor`, o
 * mesmo caminho do webhook. O que se testa aqui e o que e dela — quem ela
 * escolhe olhar, como conta, e que uma falha nao para a fila.
 */
vi.mock('@/lib/supabase/admin', () => ({ clienteAdmin: vi.fn() }));
vi.mock('./orders-api', () => ({ consultaOrdem: vi.fn() }));

const { clienteAdmin } = await import('@/lib/supabase/admin');
const { consultaOrdem } = await import('./orders-api');
const { concilia, conciliaPedido } = await import('./conciliacao');

const AGORA = 1_760_000_000_000;

type Linha = {
  id: string;
  order_id: string;
  estado: string;
  provedor_pagamento_id: string | null;
};

let linhas: Linha[] = [];
let filtros: Record<string, unknown>[] = [];
let inseridos: Record<string, unknown>[] = [];
let atualizados: { tabela: string; dados: Record<string, unknown> }[] = [];
let repetidos = new Set<string>();

function banco() {
  vi.mocked(clienteAdmin).mockReturnValue({
    from(tabela: string) {
      const elo: Record<string, unknown> = {};
      const registra = (op: string, ...args: unknown[]) => {
        filtros.push({ tabela, op, args });
        return elo;
      };
      elo.select = () => elo;
      elo.eq = (...a: unknown[]) => registra('eq', ...a);
      elo.in = (...a: unknown[]) => registra('in', ...a);
      elo.not = (...a: unknown[]) => registra('not', ...a);
      elo.lt = (...a: unknown[]) => registra('lt', ...a);
      elo.order = () => elo;
      elo.limit = (n: number) => {
        registra('limit', n);
        return Promise.resolve({ data: linhas.slice(0, n), error: null });
      };
      elo.insert = (dados: Record<string, unknown>) => {
        inseridos.push(dados);
        return Promise.resolve(
          repetidos.has(String(dados.evento_id)) ? { error: { code: '23505' } } : { error: null }
        );
      };
      elo.update = (dados: Record<string, unknown>) => {
        atualizados.push({ tabela, dados });
        return elo;
      };
      return elo;
    },
  } as never);
}

const pendente = (id: string, extra: Partial<Linha> = {}): Linha => ({
  id: `pag-${id}`,
  order_id: `ped-${id}`,
  estado: 'pendente',
  provedor_pagamento_id: `ORD01${id}`,
  ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
  linhas = [];
  filtros = [];
  inseridos = [];
  atualizados = [];
  repetidos = new Set();
  vi.mocked(consultaOrdem).mockResolvedValue({
    estado: 'aprovado',
    status: 'processed',
    statusDetail: 'accredited',
  });
  banco();
});

describe('quem a varredura olha', () => {
  it('so o que esta em aberto, com id no provedor, e com idade', async () => {
    await concilia({ agoraMs: AGORA, idadeMinMs: 120_000, limite: 7 });

    const ops = filtros
      .filter((f) => f.tabela === 'pagamentos')
      .map((f) => [f.op, ...(f.args as unknown[])]);

    expect(ops).toContainEqual(['in', 'estado', ['criado', 'pendente']]);
    expect(ops).toContainEqual(['not', 'provedor_pagamento_id', 'is', null]);
    expect(ops).toContainEqual(['lt', 'criado_em', new Date(AGORA - 120_000).toISOString()]);
    expect(ops).toContainEqual(['limit', 7]);
  });

  it('linha sem id no provedor e pulada mesmo se o banco a devolver', async () => {
    linhas = [pendente('a', { provedor_pagamento_id: null })];

    const b = await concilia({ agoraMs: AGORA });

    expect(b.olhados).toBe(0);
    expect(consultaOrdem).not.toHaveBeenCalled();
  });
});

describe('o que a varredura faz', () => {
  it('aprovado no provedor vira pago no pedido, pelo mesmo caminho do webhook', async () => {
    linhas = [pendente('a')];

    const b = await concilia({ agoraMs: AGORA });

    expect(b).toEqual({ olhados: 1, mudados: 1, semAvanco: 0, repetidos: 0, falhas: 0 });
    expect(consultaOrdem).toHaveBeenCalledWith('ORD01a');
    expect(atualizados.find((a) => a.tabela === 'orders')?.dados).toEqual({ status: 'pago' });
  });

  it('a identidade do evento diz que veio da conciliacao', async () => {
    linhas = [pendente('a')];

    await concilia({ agoraMs: AGORA });

    expect(inseridos[0]).toMatchObject({
      evento_id: 'conciliacao:ORD01a:processed',
      tipo: 'conciliacao',
      pagamento_id: 'pag-a',
    });
  });

  // Uma falha nao para a fila: o proximo pode estar pago.
  it('provedor fora do ar num item nao impede os outros', async () => {
    linhas = [pendente('a'), pendente('b'), pendente('c')];
    vi.mocked(consultaOrdem)
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ estado: 'aprovado', status: 'processed', statusDetail: null });

    const b = await concilia({ agoraMs: AGORA });

    expect(b).toEqual({ olhados: 3, mudados: 2, semAvanco: 0, repetidos: 0, falhas: 1 });
  });

  it('pendente que continua pendente conta como sem avanco', async () => {
    linhas = [pendente('a')];
    vi.mocked(consultaOrdem).mockResolvedValue({
      estado: 'pendente',
      status: 'action_required',
      statusDetail: null,
    });

    const b = await concilia({ agoraMs: AGORA });

    expect(b.semAvanco).toBe(1);
    expect(atualizados.some((a) => a.tabela === 'pagamentos')).toBe(false);
  });

  it('pix expirado vira cancelado no pagamento, sem mexer no pedido', async () => {
    linhas = [pendente('a')];
    vi.mocked(consultaOrdem).mockResolvedValue({
      estado: 'cancelado',
      status: 'expired',
      statusDetail: null,
    });

    const b = await concilia({ agoraMs: AGORA });

    expect(b.mudados).toBe(1);
    expect(atualizados.find((a) => a.tabela === 'pagamentos')?.dados.estado).toBe('cancelado');
    expect(atualizados.some((a) => a.tabela === 'orders')).toBe(false);
  });

  it('um por vez, nunca em rajada', async () => {
    linhas = [pendente('a'), pendente('b')];
    let emVoo = 0;
    let maximo = 0;
    vi.mocked(consultaOrdem).mockImplementation(async () => {
      emVoo += 1;
      maximo = Math.max(maximo, emVoo);
      await new Promise((r) => setTimeout(r, 5));
      emVoo -= 1;
      return { estado: 'aprovado', status: 'processed', statusDetail: null };
    });

    await concilia({ agoraMs: AGORA });

    expect(maximo).toBe(1);
  });
});

describe('webhook e conciliacao no mesmo evento', () => {
  // O criterio da #114: aplicar o mesmo evento por dois caminhos nao dobra
  // nada. Nao e o indice unico que garante — os ids sao diferentes por origem
  // — e a regra de avanco: o segundo a chegar ve o estado ja final.
  it('o segundo a chegar nao muda nada', async () => {
    linhas = [pendente('a', { estado: 'aprovado' })];

    const b = await concilia({ agoraMs: AGORA });

    expect(b).toEqual({ olhados: 1, mudados: 0, semAvanco: 1, repetidos: 0, falhas: 0 });
    expect(atualizados.some((a) => a.tabela === 'orders')).toBe(false);
  });

  it('a mesma varredura duas vezes conta o repetido, nao o muda', async () => {
    linhas = [pendente('a')];
    repetidos.add('conciliacao:ORD01a:processed');

    const b = await concilia({ agoraMs: AGORA });

    expect(b.repetidos).toBe(1);
    expect(atualizados).toEqual([]);
  });
});

describe('conciliaPedido', () => {
  it('olha so os pagamentos daquele pedido', async () => {
    linhas = [pendente('a')];

    await conciliaPedido('ped-a', AGORA);

    const ops = filtros
      .filter((f) => f.tabela === 'pagamentos')
      .map((f) => [f.op, ...(f.args as unknown[])]);
    expect(ops).toContainEqual(['eq', 'order_id', 'ped-a']);
    expect(ops).toContainEqual(['in', 'estado', ['criado', 'pendente']]);
  });

  it('diz que mudou quando aplicou', async () => {
    // Id proprio: o limite por pedido e estado de modulo, e 'ped-a' ja gastou
    // a cota no teste anterior.
    linhas = [pendente('m')];

    expect(await conciliaPedido('ped-m', AGORA)).toBe(true);
    expect(atualizados.find((a) => a.tabela === 'orders')?.dados).toEqual({ status: 'pago' });
  });

  it('diz que nao mudou quando o provedor ainda espera', async () => {
    linhas = [pendente('b')];
    vi.mocked(consultaOrdem).mockResolvedValue({
      estado: 'pendente',
      status: 'action_required',
      statusDetail: null,
    });

    expect(await conciliaPedido('ped-b', AGORA)).toBe(false);
  });

  // F5 em sequencia nao vira rajada no provedor.
  it('uma consulta por minuto por pedido', async () => {
    linhas = [pendente('c')];

    await conciliaPedido('ped-c', AGORA);
    await conciliaPedido('ped-c', AGORA);
    await conciliaPedido('ped-c', AGORA);

    expect(consultaOrdem).toHaveBeenCalledTimes(1);
  });

  it('o limite e por pedido, nao global', async () => {
    linhas = [pendente('d')];
    await conciliaPedido('ped-d', AGORA);
    linhas = [pendente('e')];
    await conciliaPedido('ped-e', AGORA);

    expect(consultaOrdem).toHaveBeenCalledTimes(2);
  });
});
