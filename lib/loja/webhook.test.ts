import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A barreira que mais se esquece: assinatura valida prova que a notificacao e
 * autentica, NAO que o `status` escrito nela ainda vale. Metade destes testes
 * existe para garantir que o corpo nunca decide dinheiro.
 */
vi.mock('@/lib/supabase/admin', () => ({ clienteAdmin: vi.fn() }));
vi.mock('./orders-api', () => ({ consultaOrdem: vi.fn() }));

const { clienteAdmin } = await import('@/lib/supabase/admin');
const { consultaOrdem } = await import('./orders-api');
const { processa } = await import('./webhook');

const RECURSO = 'ORD01ABC';

let inseridos: { tabela: string; dados: Record<string, unknown> }[] = [];
let atualizados: { tabela: string; dados: Record<string, unknown> }[] = [];

function banco({
  pagamento = { id: 'pag-1', order_id: 'ped-1', estado: 'pendente' } as Record<
    string,
    unknown
  > | null,
  eventoRepetido = false,
}) {
  vi.mocked(clienteAdmin).mockReturnValue({
    from(tabela: string) {
      const elo: Record<string, unknown> = {};
      elo.select = () => elo;
      elo.eq = () => elo;
      elo.maybeSingle = () => Promise.resolve({ data: pagamento, error: null });
      elo.insert = (dados: Record<string, unknown>) => {
        inseridos.push({ tabela, dados });
        return Promise.resolve(
          eventoRepetido && tabela === 'pagamento_eventos'
            ? { error: { code: '23505' } }
            : { error: null }
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

const notificacao = (extra: Record<string, unknown> = {}) => ({
  id: 'evt-1',
  type: 'order',
  action: 'order.updated',
  data: { id: RECURSO },
  ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
  inseridos = [];
  atualizados = [];
  vi.mocked(consultaOrdem).mockResolvedValue({
    estado: 'aprovado',
    status: 'processed',
    statusDetail: 'accredited',
  });
  banco({});
});

describe('o corpo nao decide nada', () => {
  // O ataque classico: notificacao assinada de verdade, com o status trocado.
  it('ignora o status que veio no corpo e consulta o provedor', async () => {
    vi.mocked(consultaOrdem).mockResolvedValue({
      estado: 'recusado',
      status: 'failed',
      statusDetail: 'cc_rejected',
    });

    const r = await processa(
      notificacao({ status: 'approved', transactions: { payments: [{ status: 'processed' }] } }),
      RECURSO
    );

    expect(consultaOrdem).toHaveBeenCalledWith(RECURSO);
    expect(r).toEqual({ tipo: 'aplicado', estado: 'recusado' });
    expect(atualizados.find((a) => a.tabela === 'pagamentos')?.dados.estado).toBe('recusado');
  });

  it('corpo dizendo aprovado nao move o pedido se o provedor disser outra coisa', async () => {
    vi.mocked(consultaOrdem).mockResolvedValue({
      estado: 'pendente',
      status: 'action_required',
      statusDetail: 'waiting_transfer',
    });

    await processa(notificacao({ status: 'approved' }), RECURSO);

    expect(atualizados.some((a) => a.tabela === 'orders')).toBe(false);
  });

  // Nao conseguir confirmar nao e o mesmo que confirmar.
  it('provedor fora do ar pede reenvio, e nao muda nada', async () => {
    vi.mocked(consultaOrdem).mockResolvedValue(null);

    const r = await processa(notificacao({ status: 'approved' }), RECURSO);

    expect(r).toEqual({ tipo: 'tente-de-novo', motivo: 'nao-consegui-confirmar' });
    expect(atualizados.some((a) => a.tabela === 'pagamentos')).toBe(false);
    expect(atualizados.some((a) => a.tabela === 'orders')).toBe(false);
  });
});

describe('idempotencia', () => {
  // A idempotencia nao depende de lembrar de checar: depende do indice unico
  // recusar o insert.
  it('o evento e registrado ANTES de qualquer processamento', async () => {
    const passos: string[] = [];
    vi.mocked(consultaOrdem).mockImplementation(async () => {
      passos.push('consulta');
      return { estado: 'aprovado', status: 'processed', statusDetail: 'accredited' };
    });
    banco({});
    const original = inseridos.push.bind(inseridos);
    inseridos.push = ((...a: Parameters<typeof original>) => {
      passos.push('registro');
      return original(...a);
    }) as typeof inseridos.push;

    await processa(notificacao(), RECURSO);

    expect(passos[0]).toBe('registro');
  });

  it('evento repetido nao processa de novo', async () => {
    banco({ eventoRepetido: true });

    const r = await processa(notificacao(), RECURSO);

    expect(r).toEqual({ tipo: 'ignorado', motivo: 'evento-repetido' });
    expect(consultaOrdem).not.toHaveBeenCalled();
    expect(atualizados).toEqual([]);
  });

  // O provedor reenvia a MESMA notificacao com o mesmo `id` de corpo. Usar o
  // `x-request-id`, que muda a cada entrega, faria cada reenvio parecer novo.
  it('a identidade do evento vem do corpo, nao da entrega', async () => {
    await processa(notificacao({ id: 'evt-42' }), RECURSO);

    expect(inseridos.find((i) => i.tabela === 'pagamento_eventos')?.dados.evento_id).toBe('evt-42');
  });

  it('sem id no corpo, cai no id do recurso', async () => {
    await processa({ data: { id: RECURSO } }, RECURSO);

    expect(inseridos.find((i) => i.tabela === 'pagamento_eventos')?.dados.evento_id).toBe(RECURSO);
  });
});

describe('fora de ordem', () => {
  // Uma notificacao antiga dizendo "pendente" nao pode apagar um "aprovado"
  // que ja chegou.
  it('pendente nao derruba aprovado', async () => {
    banco({ pagamento: { id: 'pag-1', order_id: 'ped-1', estado: 'aprovado' } });
    vi.mocked(consultaOrdem).mockResolvedValue({
      estado: 'pendente',
      status: 'action_required',
      statusDetail: null,
    });

    const r = await processa(notificacao(), RECURSO);

    expect(r).toEqual({ tipo: 'ignorado', motivo: 'sem-avanco' });
    expect(atualizados.some((a) => a.tabela === 'pagamentos')).toBe(false);
  });

  it('o mesmo estado de novo nao e avanco', async () => {
    banco({ pagamento: { id: 'pag-1', order_id: 'ped-1', estado: 'aprovado' } });

    expect(await processa(notificacao(), RECURSO)).toEqual({
      tipo: 'ignorado',
      motivo: 'sem-avanco',
    });
  });

  it('estorno depois de aprovado passa', async () => {
    banco({ pagamento: { id: 'pag-1', order_id: 'ped-1', estado: 'aprovado' } });
    vi.mocked(consultaOrdem).mockResolvedValue({
      estado: 'estornado',
      status: 'refunded',
      statusDetail: null,
    });

    expect(await processa(notificacao(), RECURSO)).toEqual({
      tipo: 'aplicado',
      estado: 'estornado',
    });
  });

  // Mesmo ignorando, o que chegou fica registrado: a conciliacao precisa saber.
  it('evento sem avanco ainda registra o status que trouxe', async () => {
    banco({ pagamento: { id: 'pag-1', order_id: 'ped-1', estado: 'aprovado' } });
    vi.mocked(consultaOrdem).mockResolvedValue({
      estado: 'pendente',
      status: 'action_required',
      statusDetail: null,
    });

    await processa(notificacao(), RECURSO);

    expect(atualizados.find((a) => a.tabela === 'pagamento_eventos')?.dados.provedor_status).toBe(
      'action_required'
    );
  });
});

describe('efeito no pedido', () => {
  it('aprovado move o pedido para pago', async () => {
    await processa(notificacao(), RECURSO);

    expect(atualizados.find((a) => a.tabela === 'orders')?.dados).toEqual({ status: 'pago' });
  });

  // O ponto da #100: recusa nao cancela o pedido, e cabe outra tentativa.
  it.each(['recusado', 'pendente', 'cancelado'] as const)('%s nao mexe no pedido', async (e) => {
    vi.mocked(consultaOrdem).mockResolvedValue({ estado: e, status: e, statusDetail: null });

    await processa(notificacao(), RECURSO);

    expect(atualizados.some((a) => a.tabela === 'orders')).toBe(false);
  });
});

describe('recurso desconhecido', () => {
  it('registra o evento mesmo sem achar o pagamento', async () => {
    banco({ pagamento: null });

    const r = await processa(notificacao(), RECURSO);

    expect(r).toEqual({ tipo: 'ignorado', motivo: 'pagamento-desconhecido' });
    // Ja ficou registrado: a conciliacao precisa saber que chegou.
    expect(inseridos.some((i) => i.tabela === 'pagamento_eventos')).toBe(true);
    expect(consultaOrdem).not.toHaveBeenCalled();
  });

  it('sem recurso nenhum nao registra nada', async () => {
    const r = await processa({}, null);

    expect(r).toEqual({ tipo: 'ignorado', motivo: 'sem-recurso' });
    expect(inseridos).toEqual([]);
  });

  it('corpo nulo nao explode', async () => {
    expect((await processa(null, null)).tipo).toBe('ignorado');
  });
});
