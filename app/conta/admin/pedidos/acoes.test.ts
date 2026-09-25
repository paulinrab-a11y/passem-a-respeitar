import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A acao e a porta administrativa. O que se prova aqui e quem passa por ela
 * e o que ela nunca faz: aceitar papel do cliente, marcar "pago", pular
 * etapa, ou dizer a um nao-administrador que a porta existe.
 */
vi.mock('@/lib/supabase/servidor', () => ({ usuarioDaSessao: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ clienteAdmin: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const { usuarioDaSessao } = await import('@/lib/supabase/servidor');
const { clienteAdmin } = await import('@/lib/supabase/admin');
const { mudarStatus } = await import('./acoes');
const { adminInicial } = await import('./estado');

const ADMIN = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'dono@whynot.test',
  email_confirmed_at: '2026-09-01T00:00:00Z',
};
const CLIENTE = {
  id: '22222222-2222-4222-8222-222222222222',
  email: 'cliente@exemplo.test',
  email_confirmed_at: '2026-09-01T00:00:00Z',
};
const PEDIDO = '33333333-3333-4333-8333-333333333333';

let statusNoBanco: string | null = 'pago';
const rpc = vi.fn(async (_nome: string, _args: unknown) => ({ data: null, error: null }));

function formulario(campos: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.set(k, v);
  return f;
}

const envia = (campos: Record<string, string>) =>
  mudarStatus(adminInicial, formulario({ pedido: PEDIDO, para: 'em_producao', ...campos }));

let n = 0;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('ADMIN_EMAILS', 'dono@whynot.test');
  statusNoBanco = 'pago';
  // Id novo por teste: o limite por administrador guarda estado no modulo.
  vi.mocked(usuarioDaSessao).mockResolvedValue({
    ...ADMIN,
    id: `${ADMIN.id.slice(0, -4)}${String(n++).padStart(4, '0')}`,
  } as never);
  vi.mocked(clienteAdmin).mockReturnValue({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: statusNoBanco ? { status: statusNoBanco } : null }),
        }),
      }),
    }),
    rpc,
  } as never);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('quem passa', () => {
  it('administrador com transicao valida: chama o banco com o autor da sessao', async () => {
    const r = await envia({ motivo: 'lote 1' });

    expect(r.recado?.tom).toBe('ok');
    expect(rpc).toHaveBeenCalledWith('muda_status_pedido', {
      p_order_id: PEDIDO,
      p_para: 'em_producao',
      p_autor: expect.stringMatching(/^11111111-/),
      p_motivo: 'lote 1',
    });
  });

  it('motivo vazio vira null, nao string vazia', async () => {
    await envia({ motivo: '' });

    expect(rpc.mock.calls[0][1]).toMatchObject({ p_motivo: null });
  });

  // O papel vem do servidor. Um campo `admin=true` no formulario e ruido.
  it('cliente comum recebe a mesma resposta de pedido inexistente, e nao toca no banco', async () => {
    vi.mocked(usuarioDaSessao).mockResolvedValue(CLIENTE as never);

    const r = await envia({ admin: 'true', role: 'admin' });

    expect(r.recado?.texto).toBe('Pedido não encontrado.');
    expect(rpc).not.toHaveBeenCalled();
    expect(clienteAdmin).not.toHaveBeenCalled();
  });

  it('e-mail de administrador sem verificacao nao passa', async () => {
    vi.mocked(usuarioDaSessao).mockResolvedValue({ ...ADMIN, email_confirmed_at: null } as never);

    expect((await envia({})).recado?.texto).toBe('Pedido não encontrado.');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('sem sessao nao passa', async () => {
    vi.mocked(usuarioDaSessao).mockResolvedValue(null);

    expect((await envia({})).recado?.texto).toBe('Pedido não encontrado.');
  });

  it('sem ADMIN_EMAILS ninguem passa', async () => {
    vi.stubEnv('ADMIN_EMAILS', '');

    expect((await envia({})).recado?.texto).toBe('Pedido não encontrado.');
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('o que nunca acontece', () => {
  it('nao pula etapa: pago -> entregue', async () => {
    const r = await envia({ para: 'entregue' });

    expect(r.recado?.tom).toBe('erro');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('ninguem marca pago na mao', async () => {
    statusNoBanco = 'aguardando_pagamento';
    const r = await envia({ para: 'pago' });

    expect(r.recado?.tom).toBe('erro');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('status fora do enum nem passa no schema', async () => {
    const r = await envia({ para: 'sumiu' });

    expect(r.recado?.texto).toBe('Confira os dados.');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('pedido que nao existe', async () => {
    statusNoBanco = null;

    expect((await envia({})).recado?.texto).toBe('Pedido não encontrado.');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('motivo longo demais nao passa', async () => {
    const r = await envia({ motivo: 'x'.repeat(301) });

    expect(r.recado?.texto).toBe('Confira os dados.');
  });

  // O banco e a segunda validacao. Se ele recusar (alguem mudou o status no
  // meio), a resposta e honesta e nao inventa sucesso.
  it('recusa do banco vira "recarregue", nunca sucesso', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'P0001', message: 'x' } as never });

    const r = await envia({});

    expect(r.recado?.tom).toBe('erro');
    expect(r.recado?.texto).toMatch(/recarregue/i);
  });

  it('para depois de sessenta mudancas na hora', async () => {
    const fixo = { ...ADMIN, id: '11111111-1111-4111-8111-999999999999' };
    vi.mocked(usuarioDaSessao).mockResolvedValue(fixo as never);

    for (let i = 0; i < 60; i++) await envia({});
    const r = await envia({});

    expect(r.recado?.texto).toMatch(/muitas mudanças/i);
  });
});
