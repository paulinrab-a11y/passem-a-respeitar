import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A conciliacao nao decide nada sozinha: ela reusa `confirmaPeloProvedor` e
 * `casaOrfa`, os mesmos caminhos do webhook. O que se testa aqui e o que e
 * dela — quem ela escolhe olhar, como conta, e que uma falha nao para a fila.
 */
vi.mock('@/lib/supabase/admin', () => ({ clienteAdmin: vi.fn() }));
vi.mock('./orders-api', () => ({
  consultaOrdem: vi.fn(),
  localizaOrdem: vi.fn(),
  buscaOrdensPorReferencia: vi.fn(),
}));

const { clienteAdmin } = await import('@/lib/supabase/admin');
const { buscaOrdensPorReferencia, consultaOrdem } = await import('./orders-api');
const { concilia, conciliaPedido } = await import('./conciliacao');

const AGORA = 1_760_000_000_000;
const UM_DIA = 24 * 60 * 60 * 1000;

type Linha = {
  id: string;
  order_id: string;
  estado: string;
  provedor_pagamento_id: string | null;
  criado_em: string;
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
      const ops: unknown[][] = [];
      let emUpdate = false;
      const registra = (op: string, ...args: unknown[]) => {
        filtros.push({ tabela, op, args });
        ops.push([op, ...args]);
        return elo;
      };
      // O que o banco devolveria: tudo, ou so o pedido filtrado por `eq`.
      const selecionadas = () => {
        const porPedido = ops.find((o) => o[0] === 'eq' && o[1] === 'order_id');
        return porPedido ? linhas.filter((l) => l.order_id === porPedido[2]) : linhas;
      };
      elo.select = () => (emUpdate ? Promise.resolve({ data: [{ id: 'x' }], error: null }) : elo);
      elo.eq = (...a: unknown[]) => registra('eq', ...a);
      elo.in = (...a: unknown[]) => registra('in', ...a);
      elo.is = (...a: unknown[]) => registra('is', ...a);
      elo.not = (...a: unknown[]) => registra('not', ...a);
      elo.lt = (...a: unknown[]) => registra('lt', ...a);
      elo.or = (...a: unknown[]) => registra('or', ...a);
      elo.order = () => elo;
      elo.limit = (n: number) => {
        registra('limit', n);
        return Promise.resolve({ data: selecionadas().slice(0, n), error: null });
      };
      elo.insert = (dados: Record<string, unknown>) => {
        inseridos.push(dados);
        return Promise.resolve(
          repetidos.has(String(dados.evento_id)) ? { error: { code: '23505' } } : { error: null }
        );
      };
      elo.update = (dados: Record<string, unknown>) => {
        atualizados.push({ tabela, dados });
        emUpdate = true;
        return elo;
      };
      // Consulta sem terminal proprio (`select ... order`): o `await` cai aqui,
      // como no builder de verdade do Supabase, que tambem e thenable.
      // biome-ignore lint/suspicious/noThenProperty: o dublê imita um builder thenable
      elo.then = (resolve: (v: unknown) => void) =>
        resolve({
          data: tabela === 'pagamentos' && !emUpdate ? selecionadas() : null,
          error: null,
        });
      return elo;
    },
  } as never);
}

const pendente = (id: string, extra: Partial<Linha> = {}): Linha => ({
  id: `pag-${id}`,
  order_id: `ped-${id}`,
  estado: 'pendente',
  provedor_pagamento_id: `ORD01${id}`,
  criado_em: new Date(AGORA - 10 * 60_000).toISOString(),
  ...extra,
});

/** Tentativa cuja resposta se perdeu: em aberto, sem id do provedor. */
const orfa = (id: string, criadaEmMs: number): Linha =>
  pendente(id, {
    estado: 'criado',
    provedor_pagamento_id: null,
    criado_em: new Date(criadaEmMs).toISOString(),
  });

const APROVADO = { estado: 'aprovado' as const, status: 'processed', statusDetail: 'accredited' };

beforeEach(() => {
  vi.clearAllMocks();
  linhas = [];
  filtros = [];
  inseridos = [];
  atualizados = [];
  repetidos = new Set();
  vi.mocked(consultaOrdem).mockResolvedValue(APROVADO);
  vi.mocked(buscaOrdensPorReferencia).mockResolvedValue({ ok: true, ordens: [] });
  banco();
});

describe('quem a varredura olha', () => {
  it('so o que esta em aberto e com idade; sem id no provedor, so dentro da janela', async () => {
    await concilia({ agoraMs: AGORA, idadeMinMs: 120_000, limite: 7 });

    const ops = filtros
      .filter((f) => f.tabela === 'pagamentos')
      .map((f) => [f.op, ...(f.args as unknown[])]);

    expect(ops).toContainEqual(['in', 'estado', ['criado', 'pendente']]);
    expect(ops).toContainEqual(['lt', 'criado_em', new Date(AGORA - 120_000).toISOString()]);
    // Com id, qualquer idade. Sem id (resposta que se perdeu), ate um dia:
    // depois disso a ordem nao vai mais aparecer la.
    expect(ops).toContainEqual([
      'or',
      `provedor_pagamento_id.not.is.null,criado_em.gte.${new Date(AGORA - UM_DIA).toISOString()}`,
    ]);
    expect(ops).toContainEqual(['limit', 7]);
  });

  // A linha sem id e a tentativa cuja resposta se perdeu (#5). Ela e procurada
  // pela referencia — a ordem dela, ninguem sabe qual e.
  it('linha sem id no provedor e procurada pela referencia e casada', async () => {
    const criada = AGORA - 10 * 60_000;
    linhas = [orfa('a', criada)];
    vi.mocked(buscaOrdensPorReferencia).mockResolvedValue({
      ok: true,
      ordens: [
        { provedorId: 'ORD01a', referencia: 'ped-a', criadaEmMs: criada + 2000, resumo: APROVADO },
      ],
    });

    const b = await concilia({ agoraMs: AGORA });

    expect(consultaOrdem).not.toHaveBeenCalled();
    expect(buscaOrdensPorReferencia).toHaveBeenCalledWith('ped-a', {
      desdeMs: criada - 5000,
      ateMs: AGORA + 5000,
    });
    expect(b).toEqual({ olhados: 1, mudados: 1, semAvanco: 0, repetidos: 0, falhas: 0 });
    const pagamentos = atualizados.filter((a) => a.tabela === 'pagamentos').map((a) => a.dados);
    expect(pagamentos[0]).toEqual({ provedor_pagamento_id: 'ORD01a' });
    expect(atualizados.find((a) => a.tabela === 'orders')?.dados).toEqual({ status: 'pago' });
    expect(inseridos[0]).toMatchObject({
      evento_id: 'conciliacao:ORD01a:processed',
      tipo: 'conciliacao',
      pagamento_id: 'pag-a',
    });
  });

  it('linha sem id cuja ordem nao apareceu conta como sem avanco', async () => {
    linhas = [orfa('a', AGORA - 10 * 60_000)];

    const b = await concilia({ agoraMs: AGORA });

    expect(b).toEqual({ olhados: 1, mudados: 0, semAvanco: 1, repetidos: 0, falhas: 0 });
    expect(atualizados).toEqual([]);
  });

  it('busca fora do ar conta como falha e nao para a fila', async () => {
    linhas = [orfa('a', AGORA - 10 * 60_000), pendente('b')];
    vi.mocked(buscaOrdensPorReferencia).mockResolvedValue({ ok: false });

    const b = await concilia({ agoraMs: AGORA });

    expect(b).toEqual({ olhados: 2, mudados: 1, semAvanco: 0, repetidos: 0, falhas: 1 });
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
    linhas = [pendente('a', { estado: 'aprovado' })];
    repetidos.add('conciliacao:ORD01a:processed');

    const b = await concilia({ agoraMs: AGORA });

    expect(b.repetidos).toBe(1);
    expect(atualizados.some((a) => a.tabela === 'pagamentos')).toBe(false);
    expect(atualizados.some((a) => a.tabela === 'orders')).toBe(false);
  });

  // O buraco que a rodada ao vivo mostrou: evento ja registrado, estado que
  // nao acompanhou (processo caiu entre gravar o evento e atualizar). Se o
  // repetido encerrasse antes de aplicar, ficaria preso para sempre.
  it('evento repetido com estado atrasado e curado, nao ignorado', async () => {
    linhas = [pendente('a')];
    repetidos.add('conciliacao:ORD01a:processed');

    const b = await concilia({ agoraMs: AGORA });

    expect(b.mudados).toBe(1);
    expect(b.repetidos).toBe(0);
    expect(atualizados.find((a) => a.tabela === 'orders')?.dados).toEqual({ status: 'pago' });
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

  // Quem pagou e viu "tente de novo" abre o pedido: e aqui que a tentativa
  // sem id dele reencontra a ordem, antes de qualquer cron.
  it('tambem procura pela referencia a tentativa sem id do pedido', async () => {
    const criada = AGORA - 60_000;
    linhas = [orfa('o', criada)];
    vi.mocked(buscaOrdensPorReferencia).mockResolvedValue({
      ok: true,
      ordens: [
        { provedorId: 'ORD01o', referencia: 'ped-o', criadaEmMs: criada + 2000, resumo: APROVADO },
      ],
    });

    expect(await conciliaPedido('ped-o', AGORA)).toBe(true);
    expect(consultaOrdem).not.toHaveBeenCalled();
    expect(atualizados.find((a) => a.tabela === 'orders')?.dados).toEqual({ status: 'pago' });
  });
});
