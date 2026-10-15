import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Pedir cancelamento, desistir, trocar ou avisar de defeito (#379).
 *
 * O que se prova aqui: a acao usa o client da SESSAO (nunca o de servico),
 * manda so as tres colunas que a pessoa escolhe, devolve o protocolo para a
 * tela confirmar na hora, e traduz as recusas do banco em recado util. A
 * regra de quando cabe e do banco, e e provada em supabase/tests/pos-venda.sql.
 */
vi.mock('@/lib/supabase/servidor', () => ({
  usuarioDaSessao: vi.fn(),
  clienteServidor: vi.fn(),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'x-forwarded-for': '203.0.113.9' }),
}));

const { usuarioDaSessao, clienteServidor } = await import('@/lib/supabase/servidor');
const { revalidatePath } = await import('next/cache');
const { pedirPosVenda } = await import('./acoes');
const { posVendaInicial } = await import('./estado');

const PEDIDO = '44444444-4444-4444-8444-444444444444';

let inseridos: Record<string, unknown>[] = [];
let respostaDoInsert: { data: unknown; error: unknown } = { data: null, error: null };
let aberta: unknown = null;

function banco() {
  vi.mocked(clienteServidor).mockResolvedValue({
    from: () => {
      const elo: Record<string, unknown> = {};
      elo.insert = (linha: Record<string, unknown>) => {
        inseridos.push(linha);
        return elo;
      };
      elo.select = () => elo;
      elo.eq = () => elo;
      elo.is = () => elo;
      elo.single = async () => respostaDoInsert;
      elo.maybeSingle = async () => ({ data: aberta, error: null });
      return elo;
    },
  } as never);
}

function formulario(campos: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.set(k, v);
  return f;
}

const pede = (campos: Record<string, string> = {}) =>
  pedirPosVenda(posVendaInicial, formulario({ pedido: PEDIDO, tipo: 'cancelamento', ...campos }));

let n = 0;

beforeEach(() => {
  vi.clearAllMocks();
  inseridos = [];
  aberta = null;
  respostaDoInsert = {
    data: { protocolo: 'PV-ABCDEF12', criado_em: '2026-10-15T22:00:00Z' },
    error: null,
  };
  // Id novo por teste: o limite por conta guarda estado no modulo.
  vi.mocked(usuarioDaSessao).mockResolvedValue({
    id: `55555555-5555-4555-8555-${String(n++).padStart(12, '0')}`,
  } as never);
  banco();
});

describe('pedirPosVenda', () => {
  it('sem sessao nao chega ao banco', async () => {
    vi.mocked(usuarioDaSessao).mockResolvedValue(null);

    const r = await pede();

    expect(r.erro).toMatch(/Entre de novo/);
    expect(clienteServidor).not.toHaveBeenCalled();
  });

  it('grava so pedido, tipo e mensagem, e devolve o protocolo na hora', async () => {
    const r = await pede({ mensagem: '  mudei de ideia  ', user_id: 'outra', resolvida_em: 'x' });

    expect(inseridos).toEqual([
      { order_id: PEDIDO, tipo: 'cancelamento', mensagem: 'mudei de ideia' },
    ]);
    expect(r).toEqual({
      erro: null,
      recebido: {
        tipo: 'cancelamento',
        protocolo: 'PV-ABCDEF12',
        criadoEm: '2026-10-15T22:00:00Z',
        jaExistia: false,
      },
    });
    expect(revalidatePath).toHaveBeenCalledWith(`/conta/pedidos/${PEDIDO}`);
    expect(revalidatePath).toHaveBeenCalledWith('/conta/admin/pedidos');
  });

  it('mensagem vazia vai como nula', async () => {
    await pede({ mensagem: '   ' });
    expect(inseridos[0]).toMatchObject({ mensagem: null });
  });

  it('tipo fora do enum e id torto nem chegam ao banco', async () => {
    expect((await pede({ tipo: 'devolver-tudo' })).erro).toMatch(/Recarregue/);
    expect((await pede({ pedido: '1' })).erro).toMatch(/Recarregue/);
    expect(inseridos).toEqual([]);
  });

  it('mensagem longa demais diz o teto', async () => {
    const r = await pede({ mensagem: 'x'.repeat(501) });
    expect(r.erro).toMatch(/500 caracteres/);
    expect(inseridos).toEqual([]);
  });

  it('ja aberta: devolve o protocolo que existe, sem erro', async () => {
    respostaDoInsert = { data: null, error: { code: '23505' } };
    aberta = { protocolo: 'PV-00000099', criado_em: '2026-10-14T10:00:00Z' };

    const r = await pede();

    expect(r.erro).toBeNull();
    expect(r.recebido).toMatchObject({ protocolo: 'PV-00000099', jaExistia: true });
  });

  it('recusa da policy (status ou prazo mudou) manda recarregar e lembra o e-mail', async () => {
    respostaDoInsert = { data: null, error: { code: '42501' } };

    const r = await pede();

    expect(r.recebido).toBeNull();
    expect(r.erro).toMatch(/Recarregue a página.*escreva para a loja/);
  });

  it('banco fora: erro honesto, nunca protocolo', async () => {
    respostaDoInsert = { data: null, error: { code: '08006' } };

    const r = await pede();

    expect(r.recebido).toBeNull();
    expect(r.erro).toMatch(/Tente de novo/);
  });

  it('para depois de dez pedidos na hora', async () => {
    vi.mocked(usuarioDaSessao).mockResolvedValue({
      id: '55555555-5555-4555-8555-999999999999',
    } as never);
    for (let i = 0; i < 10; i++) await pede();

    expect((await pede()).erro).toMatch(/Muitos pedidos/);
  });
});
