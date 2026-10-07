import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A acao e a porta administrativa. O que se prova aqui e quem passa por ela
 * e o que ela nunca faz: aceitar papel do cliente, marcar "pago", pular
 * etapa, ou dizer a um nao-administrador que a porta existe.
 *
 * O Mercado Pago e um dublê; o encerramento das cobrancas abertas roda de
 * verdade, e o que se prova e que ele vem ANTES do status, e que o status nao
 * muda se ele falhar (#21).
 */
vi.mock('@sentry/nextjs', () => ({ captureMessage: vi.fn(), flush: async () => true }));
vi.mock('@/lib/supabase/servidor', () => ({ usuarioDaSessao: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ clienteAdmin: vi.fn() }));
vi.mock('@/lib/loja/orders-api', () => ({
  cancelaOrdem: vi.fn(),
  consultaOrdem: vi.fn(),
  localizaOrdem: vi.fn(),
  buscaOrdensPorReferencia: vi.fn(),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const { usuarioDaSessao } = await import('@/lib/supabase/servidor');
const { clienteAdmin } = await import('@/lib/supabase/admin');
const { cancelaOrdem, consultaOrdem } = await import('@/lib/loja/orders-api');
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
/** Tentativas do pedido ainda abertas no provedor. */
let abertas: Record<string, unknown>[] = [];
let atualizados: { tabela: string; dados: Record<string, unknown> }[] = [];
const rpc = vi.fn(async (_nome: string, _args: unknown) => ({ data: null, error: null }));

function banco() {
  vi.mocked(clienteAdmin).mockReturnValue({
    from(tabela: string) {
      const elo: Record<string, unknown> = {};
      const ops: unknown[][] = [];
      let emUpdate = false;
      const anota =
        (op: string) =>
        (...args: unknown[]) => {
          ops.push([op, ...args]);
          return elo;
        };
      elo.eq = anota('eq');
      elo.neq = anota('neq');
      elo.in = anota('in');
      elo.not = anota('not');
      elo.select = () => (emUpdate ? Promise.resolve({ data: [{ id: 'x' }], error: null }) : elo);
      elo.maybeSingle = async () => ({ data: statusNoBanco ? { status: statusNoBanco } : null });
      elo.update = (dados: Record<string, unknown>) => {
        atualizados.push({ tabela, dados });
        emUpdate = true;
        return elo;
      };
      elo.insert = () => Promise.resolve({ error: null });
      // O banco aplicaria os filtros por linha; sem eles, a busca das irmas
      // "menos a propria" devolveria a propria para sempre.
      const selecionadas = () =>
        abertas.filter((l) =>
          ops.every(([op, coluna, ...resto]) => {
            if (!(typeof coluna === 'string' && coluna in l)) return true;
            const valor = l[coluna];
            if (op === 'eq') return valor === resto[0];
            if (op === 'neq') return valor !== resto[0];
            if (op === 'in') return (resto[0] as unknown[]).includes(valor);
            if (op === 'not') return !(resto[0] === 'is' && valor === resto[1]);
            return true;
          })
        );
      // Consulta sem terminal proprio (as tentativas abertas): o `await` cai
      // aqui, como no builder de verdade do Supabase, que tambem e thenable.
      // biome-ignore lint/suspicious/noThenProperty: o dublê imita um builder thenable
      elo.then = (resolve: (v: unknown) => void) =>
        resolve({
          data: tabela === 'pagamentos' && !emUpdate ? selecionadas() : null,
          error: null,
        });
      return elo;
    },
    rpc,
  } as never);
}

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
  abertas = [];
  atualizados = [];
  // Id novo por teste: o limite por administrador guarda estado no modulo.
  vi.mocked(usuarioDaSessao).mockResolvedValue({
    ...ADMIN,
    id: `${ADMIN.id.slice(0, -4)}${String(n++).padStart(4, '0')}`,
  } as never);
  vi.mocked(cancelaOrdem).mockResolvedValue({ ok: true, status: 'canceled', statusDetail: null });
  banco();
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

/**
 * O cenario da #21: o cliente gera o Pix, o dono cancela o pedido, o cliente
 * paga o QR mesmo assim. Cancelar o pedido tem que cancelar ANTES a cobranca
 * aberta no provedor — e se nao der, o pedido nao e cancelado.
 */
describe('cancelar pedido que espera pagamento', () => {
  const PIX = {
    id: 'pag-pix',
    order_id: PEDIDO,
    estado: 'pendente',
    provedor_pagamento_id: 'ORD-PIX',
    idempotency_key: 'chave-pix',
  };
  const cancelar = () => envia({ para: 'cancelado', motivo: 'duplicado' });

  beforeEach(() => {
    statusNoBanco = 'aguardando_pagamento';
  });

  it('cancela a cobranca aberta no provedor e marca o pagamento antes de mudar o status', async () => {
    abertas = [PIX];

    const r = await cancelar();

    expect(r.recado?.tom).toBe('ok');
    expect(cancelaOrdem).toHaveBeenCalledWith('ORD-PIX', expect.any(String));
    expect(atualizados.find((a) => a.tabela === 'pagamentos')?.dados).toEqual({
      estado: 'cancelado',
      provedor_status: 'canceled',
      provedor_status_detail: null,
    });
    // Provedor primeiro, pedido depois: a ordem E a protecao.
    expect(vi.mocked(cancelaOrdem).mock.invocationCallOrder[0]).toBeLessThan(
      rpc.mock.invocationCallOrder[0]
    );
    expect(rpc).toHaveBeenCalledWith(
      'muda_status_pedido',
      expect.objectContaining({ p_para: 'cancelado' })
    );
  });

  it('sem cobranca aberta, cancela direto', async () => {
    const r = await cancelar();

    expect(r.recado?.tom).toBe('ok');
    expect(cancelaOrdem).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('se a cobranca aberta nao puder ser cancelada, o pedido nao muda', async () => {
    abertas = [PIX];
    vi.mocked(cancelaOrdem).mockResolvedValue({ ok: false, motivo: 'indisponivel' });

    const r = await cancelar();

    expect(r.recado?.tom).toBe('erro');
    expect(r.recado?.texto).toMatch(/não consegui cancelar/i);
    expect(rpc).not.toHaveBeenCalled();
  });

  // O provedor nao deixa cancelar porque ja foi paga: o pedido que a pessoa
  // esta olhando ja nao e o pedido que existe.
  it('cobranca que o provedor diz ja estar paga: nao cancela o pedido, manda recarregar', async () => {
    abertas = [PIX];
    vi.mocked(cancelaOrdem).mockResolvedValue({ ok: false, motivo: 'invalido' });
    vi.mocked(consultaOrdem).mockResolvedValue({
      estado: 'aprovado',
      status: 'processed',
      statusDetail: 'accredited',
    });

    const r = await cancelar();

    expect(r.recado?.tom).toBe('erro');
    expect(r.recado?.texto).toMatch(/pagamento aprovado.*recarregue/i);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('cancelar pedido pago nao toca em cobranca', async () => {
    statusNoBanco = 'pago';
    abertas = [PIX];

    const r = await cancelar();

    expect(r.recado?.tom).toBe('ok');
    expect(cancelaOrdem).not.toHaveBeenCalled();
    expect(clienteAdmin).toHaveBeenCalled();
  });
});
