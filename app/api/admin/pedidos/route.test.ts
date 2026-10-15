import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * "Exportar CSV" do painel (#345). O que se prova: quem nao administra nao
 * descobre que a rota existe, a cota vem antes do banco, o filtro da URL
 * passa pela lista fechada, e a resposta nao fica em cache nenhum.
 */

type Sessao = { id: string; email: string; email_confirmed_at: string | null } | null;

const usuarioDaSessao = vi.fn<() => Promise<Sessao>>();
const limita = vi.fn<() => Promise<{ permitido: boolean; esperarS: number }>>();
const consulta = {
  select: vi.fn(),
  in: vi.fn(),
  order: vi.fn(),
  limit: vi.fn(),
};
const from = vi.fn();

vi.mock('@/lib/supabase/servidor', () => ({ usuarioDaSessao: () => usuarioDaSessao() }));
vi.mock('@/lib/rate-limit', () => ({ limita: () => limita() }));
vi.mock('@/lib/supabase/admin', () => ({ clienteAdmin: () => ({ from }) }));

const { GET } = await import('./route');

const DONO = { id: 'dono-1', email: 'dono@exemplo.test', email_confirmed_at: '2026-10-01' };

const pede = (busca = '') =>
  GET(new NextRequest(`https://passem-a-respeitar.test/api/admin/pedidos${busca}`));

const PEDIDO = {
  numero: 1,
  criado_em: '2026-10-15T17:03:00.000Z',
  status: 'pago',
  total_centavos: 14990,
  frete_centavos: 2990,
  frete_servico: 'sedex',
  frete_prazo_dias: 3,
  entrega_nome: '=1+1',
  entrega_cep: '01310100',
  entrega_logradouro: 'Avenida Paulista',
  entrega_numero: '1000',
  entrega_complemento: null,
  entrega_bairro: 'Bela Vista',
  entrega_cidade: 'São Paulo',
  entrega_uf: 'SP',
  order_items: [{ nome: 'Camiseta CBAC', tamanho: 'M', quantidade: 1 }],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('ADMIN_EMAILS', DONO.email);
  usuarioDaSessao.mockResolvedValue(DONO);
  limita.mockResolvedValue({ permitido: true, esperarS: 0 });
  from.mockReturnValue(consulta);
  consulta.select.mockReturnValue(consulta);
  consulta.in.mockReturnValue(consulta);
  consulta.order.mockReturnValue(consulta);
  consulta.limit.mockResolvedValue({ data: [PEDIDO], error: null });
});

describe('GET /api/admin/pedidos', () => {
  it('sem sessao e 404, sem cota e sem banco', async () => {
    usuarioDaSessao.mockResolvedValue(null);

    const r = await pede();

    expect(r.status).toBe(404);
    expect(limita).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it('quem nao administra recebe 404, igual a quem nao tem sessao', async () => {
    usuarioDaSessao.mockResolvedValue({ ...DONO, email: 'cliente@exemplo.test' });

    const r = await pede();

    expect(r.status).toBe(404);
    expect(from).not.toHaveBeenCalled();
  });

  it('e-mail do dono sem verificar nao administra', async () => {
    usuarioDaSessao.mockResolvedValue({ ...DONO, email_confirmed_at: null });

    expect((await pede()).status).toBe(404);
  });

  it('fora da cota e 429 com Retry-After, antes do banco', async () => {
    limita.mockResolvedValue({ permitido: false, esperarS: 300 });

    const r = await pede();

    expect(r.status).toBe(429);
    expect(r.headers.get('Retry-After')).toBe('300');
    expect(from).not.toHaveBeenCalled();
  });

  it('devolve o CSV como anexo, sem cache, e a formula do comprador neutralizada', async () => {
    const r = await pede();

    expect(r.status).toBe(200);
    expect(r.headers.get('Content-Type')).toBe('text/csv; charset=utf-8');
    expect(r.headers.get('Content-Disposition')).toMatch(
      /^attachment; filename="pedidos-\d{4}-\d{2}-\d{2}\.csv"$/
    );
    expect(r.headers.get('Cache-Control')).toBe('no-store, private');

    const texto = await r.text();
    expect(texto).toContain('"\'=1+1"');
    expect(texto).not.toContain('"=1+1"');
  });

  it('nenhuma coluna interna na consulta', async () => {
    await pede();

    const colunas = String(consulta.select.mock.calls[0][0]);
    for (const interna of [
      'user_id',
      'pagamento_id',
      'pagamento_provedor',
      'anonimizado_em',
      'id,',
    ]) {
      expect(colunas).not.toContain(interna);
    }
  });

  it('o filtro padrao e o da tela: pago e em producao', async () => {
    await pede();

    expect(consulta.in).toHaveBeenCalledWith('status', ['pago', 'em_producao']);
  });

  it('"todos" nao filtra', async () => {
    await pede('?status=todos');

    expect(consulta.in).not.toHaveBeenCalled();
  });

  it('status inventado cai no padrao, e o texto da URL nunca chega ao in()', async () => {
    await pede('?status=extraviado');

    expect(consulta.in).toHaveBeenCalledWith('status', ['pago', 'em_producao']);
  });

  it('banco fora do ar e 503 com recado, nao planilha vazia', async () => {
    consulta.limit.mockResolvedValue({ data: null, error: { code: '08006' } });
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const r = await pede();

    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ erro: expect.any(String) });
  });
});
