import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A expiracao do pedido nao pago (#298).
 *
 * Banco e o que vem de webhook.ts sao dublês: achar a orfa no provedor e
 * cancelar a ordem la se provam em webhook.test.ts. Aqui se prova a DECISAO
 * da expiracao diante do que eles respondem — e, acima de tudo, que pedido
 * com pagamento aprovado nunca e cancelado, e que Pix vivo no provedor morre
 * antes do pedido.
 */
vi.mock('@/lib/supabase/admin', () => ({ clienteAdmin: vi.fn() }));
vi.mock('@/lib/rate-limit', () => ({ limita: vi.fn() }));
vi.mock('./webhook', () => ({
  casaOrfa: vi.fn(),
  encerraAbertas: vi.fn(),
  orfasDoPedido: vi.fn(),
}));

const { clienteAdmin } = await import('@/lib/supabase/admin');
const { limita } = await import('@/lib/rate-limit');
const { casaOrfa, encerraAbertas, orfasDoPedido } = await import('./webhook');
const { expiraPedido, expiraVencidos } = await import('./expiracao');
const { VALIDADE_DO_PEDIDO_MS } = await import('./validade-do-pedido');

const AGORA = Date.parse('2026-10-15T12:00:00Z');
const PEDIDO = '11111111-2222-4333-8444-555555555555';
const OUTRO = '66666666-7777-4888-8999-000000000000';

const SEM_ABERTAS = { encerradas: 0, aprovadas: 0, presas: 0 };

/** Cada consulta a `orders`, com os filtros na ordem em que foram encadeados. */
let consultas: unknown[][][] = [];
/** O que o `update` de `orders` gravou, e com quais filtros. */
let atualizacoes: { dados: Record<string, unknown>; ops: unknown[][] }[] = [];
/** Ordem das chamadas, para provar que o provedor vem antes do pedido. */
let passos: string[] = [];

/** Um vencido, com a idade em minutos alem do corte (para a ordem da fila). */
const vencido = (id: string, minuto = 0) => ({
  id,
  criado_em: new Date(AGORA - 3 * VALIDADE_DO_PEDIDO_MS + minuto * 60_000).toISOString(),
});

function banco({
  vencidos = [vencido(PEDIDO)] as { id: string; criado_em: string }[],
  /** O `update` condicionado alcancou o pedido? */
  alcancou = true,
  erroNoUpdate = false,
  /** Erro devolvido na busca dos vencidos (o supabase-js devolve, nao lanca). */
  erroNaBusca = false,
} = {}) {
  vi.mocked(clienteAdmin).mockReturnValue({
    from(tabela: string) {
      if (tabela !== 'orders') throw new Error(`tabela inesperada: ${tabela}`);

      const ops: unknown[][] = [];
      let dadosDoUpdate: Record<string, unknown> | null = null;
      consultas.push(ops);

      const elo: Record<string, unknown> = {};
      const anota =
        (op: string) =>
        (...args: unknown[]) => {
          ops.push([op, ...args]);
          return elo;
        };
      elo.eq = anota('eq');
      elo.lt = anota('lt');
      elo.gt = anota('gt');
      elo.order = anota('order');
      elo.update = (dados: Record<string, unknown>) => {
        dadosDoUpdate = dados;
        return elo;
      };
      elo.select = (...args: unknown[]) => {
        if (dadosDoUpdate) {
          passos.push('cancela-pedido');
          atualizacoes.push({ dados: dadosDoUpdate, ops });
          return Promise.resolve(
            erroNoUpdate
              ? { data: null, error: { code: '57014' } }
              : { data: alcancou ? [{ id: PEDIDO }] : [], error: null }
          );
        }
        ops.push(['select', ...args]);
        return elo;
      };
      // O `gt` em `criado_em` e a pagina seguinte: aplica como o banco faria.
      elo.limit = (n: number) => {
        const depois = ops.find((o) => o[0] === 'gt' && o[1] === 'criado_em')?.[2] as
          | string
          | undefined;
        if (erroNaBusca) {
          return Promise.resolve({
            data: null,
            error: { code: 'PGRST000', message: 'banco fora' },
          });
        }
        const fila = depois ? vencidos.filter((v) => v.criado_em > depois) : vencidos;
        return Promise.resolve({ data: fila.slice(0, n), error: null });
      };
      elo.maybeSingle = () => Promise.resolve({ data: vencidos[0] ?? null, error: null });
      return elo;
    },
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  consultas = [];
  atualizacoes = [];
  passos = [];
  vi.mocked(orfasDoPedido).mockResolvedValue([]);
  vi.mocked(encerraAbertas).mockImplementation(async () => {
    passos.push('encerra-abertas');
    return SEM_ABERTAS;
  });
  vi.mocked(limita).mockResolvedValue({ permitido: true } as never);
  banco();
});

describe('expiraVencidos: quem entra na varredura', () => {
  it('so pedido aguardando pagamento, mais velho que o prazo e a folga', async () => {
    await expiraVencidos({ agoraMs: AGORA });

    const [busca] = consultas;
    expect(busca).toContainEqual(['eq', 'status', 'aguardando_pagamento']);

    const corte = busca.find((o) => o[0] === 'lt' && o[1] === 'criado_em')?.[2] as string;
    const idadeMinima = AGORA - Date.parse(corte);
    // Alem do prazo, e com folga para a cobranca que passou na porta no fim.
    expect(idadeMinima).toBeGreaterThan(VALIDADE_DO_PEDIDO_MS);
    expect(idadeMinima).toBeLessThanOrEqual(VALIDADE_DO_PEDIDO_MS + 60 * 60 * 1000);
  });

  it('do mais velho para o mais novo, com teto', async () => {
    banco({ vencidos: [vencido(PEDIDO), vencido(OUTRO, 1)] });

    const balanco = await expiraVencidos({ agoraMs: AGORA, limite: 1 });

    expect(consultas[0]).toContainEqual(['order', 'criado_em', { ascending: true }]);
    expect(balanco.olhados).toBe(1);
    // Parou no teto com vencido na fila: o log precisa dizer.
    expect(balanco.sobraram).toBe(true);
  });

  // Adiado continua aguardando e voltaria no topo todo dia. Com a fila presa
  // nele, um lote inteiro de adiados travava a expiracao de todo o resto.
  it('um lote inteiro de adiados nao trava os mais novos', async () => {
    const ids = ['a', 'b', 'c', 'd', 'e'];
    banco({ vencidos: ids.map((id, i) => vencido(id, i)) });
    vi.mocked(encerraAbertas)
      .mockResolvedValueOnce({ encerradas: 0, aprovadas: 0, presas: 1 })
      .mockResolvedValueOnce({ encerradas: 0, aprovadas: 0, presas: 1 })
      .mockResolvedValue(SEM_ABERTAS);

    const balanco = await expiraVencidos({ agoraMs: AGORA, lote: 2 });

    expect(balanco).toEqual({ olhados: 5, expirados: 3, pagos: 0, adiados: 2, sobraram: false });
    // A segunda pagina comeca depois do ultimo olhado, e nao no topo de novo.
    const segunda = consultas.filter((ops) => ops.some((o) => o[0] === 'order'))[1];
    expect(segunda).toContainEqual(['gt', 'criado_em', vencido('b', 1).criado_em]);
  });

  it('fila que acaba no fim de um lote nao conta como sobra', async () => {
    banco({ vencidos: [vencido(PEDIDO), vencido(OUTRO, 1)] });

    const balanco = await expiraVencidos({ agoraMs: AGORA, lote: 2 });

    expect(balanco.olhados).toBe(2);
    expect(balanco.sobraram).toBe(false);
  });

  it('para no teto mesmo no meio de um lote', async () => {
    banco({ vencidos: ['a', 'b', 'c', 'd', 'e'].map((id, i) => vencido(id, i)) });

    const balanco = await expiraVencidos({ agoraMs: AGORA, lote: 2, limite: 3 });

    expect(balanco.olhados).toBe(3);
    expect(balanco.sobraram).toBe(true);
  });

  it('sem tempo, para e deixa o resto para o proximo cron', async () => {
    const balanco = await expiraVencidos({ agoraMs: AGORA, orcamentoMs: 0 });

    expect(balanco).toMatchObject({ olhados: 0, sobraram: true });
    expect(encerraAbertas).not.toHaveBeenCalled();
  });

  // Banco fora lido como fila vazia fechava o check-in do cron como `ok` (#273).
  it('erro do banco na busca lanca, e nao vira fila vazia', async () => {
    banco({ erroNaBusca: true });

    await expect(expiraVencidos({ agoraMs: AGORA })).rejects.toThrow('a varredura nao leu o banco');
    expect(encerraAbertas).not.toHaveBeenCalled();
  });

  it('sem nada vencido, nao fala com o provedor', async () => {
    banco({ vencidos: [] });

    expect(await expiraVencidos({ agoraMs: AGORA })).toEqual({
      olhados: 0,
      expirados: 0,
      pagos: 0,
      adiados: 0,
      sobraram: false,
    });
    expect(encerraAbertas).not.toHaveBeenCalled();
  });
});

describe('expiraVencidos: o que acontece com cada pedido', () => {
  it('sem cobranca aberta, vira cancelado', async () => {
    const balanco = await expiraVencidos({ agoraMs: AGORA });

    expect(balanco).toEqual({ olhados: 1, expirados: 1, pagos: 0, adiados: 0, sobraram: false });
    expect(atualizacoes).toHaveLength(1);
    expect(atualizacoes[0].dados).toEqual({ status: 'cancelado' });
  });

  it('o cancelamento so alcanca pedido que ainda aguarda pagamento', async () => {
    await expiraVencidos({ agoraMs: AGORA });

    expect(atualizacoes[0].ops).toEqual([
      ['eq', 'id', PEDIDO],
      ['eq', 'status', 'aguardando_pagamento'],
    ]);
  });

  it('a cobranca aberta e encerrada no provedor ANTES do pedido', async () => {
    await expiraVencidos({ agoraMs: AGORA });

    expect(encerraAbertas).toHaveBeenCalledWith(expect.anything(), PEDIDO, 'expiracao');
    expect(passos).toEqual(['encerra-abertas', 'cancela-pedido']);
  });

  it('com pagamento aprovado, nunca cancela', async () => {
    vi.mocked(encerraAbertas).mockResolvedValue({ encerradas: 1, aprovadas: 1, presas: 0 });

    const balanco = await expiraVencidos({ agoraMs: AGORA });

    expect(balanco).toEqual({ olhados: 1, expirados: 0, pagos: 1, adiados: 0, sobraram: false });
    expect(atualizacoes).toEqual([]);
  });

  it('provedor nao deixou encerrar: nao cancela, fica para a proxima rodada', async () => {
    vi.mocked(encerraAbertas).mockResolvedValue({ encerradas: 0, aprovadas: 0, presas: 1 });

    const balanco = await expiraVencidos({ agoraMs: AGORA });

    expect(balanco).toEqual({ olhados: 1, expirados: 0, pagos: 0, adiados: 1, sobraram: false });
    expect(atualizacoes).toEqual([]);
  });

  it('um adiado nao para a fila', async () => {
    banco({ vencidos: [vencido(PEDIDO), vencido(OUTRO, 1)] });
    vi.mocked(encerraAbertas)
      .mockResolvedValueOnce({ encerradas: 0, aprovadas: 0, presas: 1 })
      .mockResolvedValueOnce(SEM_ABERTAS);

    const balanco = await expiraVencidos({ agoraMs: AGORA });

    expect(balanco).toEqual({ olhados: 2, expirados: 1, pagos: 0, adiados: 1, sobraram: false });
  });

  it('pedido que saiu da espera no meio (pago, cancelado pelo dono) nao conta como expirado', async () => {
    banco({ alcancou: false });

    expect(await expiraVencidos({ agoraMs: AGORA })).toEqual({
      olhados: 1,
      expirados: 0,
      pagos: 0,
      adiados: 0,
      sobraram: false,
    });
  });

  it('erro do banco ao cancelar e adiado, nao expirado', async () => {
    banco({ erroNoUpdate: true });

    expect((await expiraVencidos({ agoraMs: AGORA })).adiados).toBe(1);
  });
});

describe('expiraVencidos: tentativa sem resposta do provedor (orfa)', () => {
  const ORFA = {
    id: 'pag-orfa',
    order_id: PEDIDO,
    estado: 'criado',
    criado_em: new Date(AGORA - VALIDADE_DO_PEDIDO_MS).toISOString(),
  };

  beforeEach(() => {
    vi.mocked(orfasDoPedido).mockResolvedValue([ORFA]);
  });

  it('aprovada no provedor: o pedido virou pago e nao se cancela', async () => {
    vi.mocked(casaOrfa).mockResolvedValue({ tipo: 'aplicado', estado: 'aprovado' });

    const balanco = await expiraVencidos({ agoraMs: AGORA });

    expect(balanco.pagos).toBe(1);
    expect(encerraAbertas).not.toHaveBeenCalled();
    expect(atualizacoes).toEqual([]);
  });

  it('sem como perguntar ao provedor: adia', async () => {
    vi.mocked(casaOrfa).mockResolvedValue({ tipo: 'tente-de-novo', motivo: 'x' });

    const balanco = await expiraVencidos({ agoraMs: AGORA });

    expect(balanco.adiados).toBe(1);
    expect(atualizacoes).toEqual([]);
  });

  it('alguem vinculando agora mesmo: adia', async () => {
    vi.mocked(casaOrfa).mockResolvedValue({ tipo: 'ignorado', motivo: 'ja-vinculado' });

    expect((await expiraVencidos({ agoraMs: AGORA })).adiados).toBe(1);
  });

  it('o provedor nunca viu a tentativa: segue e cancela', async () => {
    vi.mocked(casaOrfa).mockResolvedValue({ tipo: 'ignorado', motivo: 'sem-ordem-no-provedor' });

    const balanco = await expiraVencidos({ agoraMs: AGORA });

    expect(casaOrfa).toHaveBeenCalledWith(expect.anything(), ORFA, 'expiracao', AGORA);
    expect(balanco.expirados).toBe(1);
  });

  it('ainda pendente la: ganha id e e encerrada antes do pedido', async () => {
    vi.mocked(casaOrfa).mockResolvedValue({ tipo: 'aplicado', estado: 'pendente' });

    await expiraVencidos({ agoraMs: AGORA });

    expect(passos).toEqual(['encerra-abertas', 'cancela-pedido']);
  });
});

describe('expiraPedido: a tela do pedido', () => {
  it('pedido vencido e cancelado na hora', async () => {
    expect(await expiraPedido(PEDIDO, AGORA)).toBe(true);
    expect(consultas[0]).toContainEqual(['eq', 'id', PEDIDO]);
    expect(consultas[0]).toContainEqual(['eq', 'status', 'aguardando_pagamento']);
  });

  it('o prazo e relido no banco, nunca aceito da tela', async () => {
    banco({ vencidos: [] });

    expect(await expiraPedido(PEDIDO, AGORA)).toBe(false);
    expect(encerraAbertas).not.toHaveBeenCalled();
    expect(limita).not.toHaveBeenCalled();
  });

  it('F5 em sequencia nao vira rajada no provedor', async () => {
    vi.mocked(limita).mockResolvedValue({ permitido: false } as never);

    expect(await expiraPedido(PEDIDO, AGORA)).toBe(false);
    expect(limita).toHaveBeenCalledWith(`expira:${PEDIDO}`, 1, 60 * 1000);
    expect(encerraAbertas).not.toHaveBeenCalled();
  });

  it('com pagamento aprovado, responde que nao cancelou', async () => {
    vi.mocked(encerraAbertas).mockResolvedValue({ encerradas: 0, aprovadas: 1, presas: 0 });

    expect(await expiraPedido(PEDIDO, AGORA)).toBe(false);
    expect(atualizacoes).toEqual([]);
  });
});
