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

/** Caminho assinado — o dos testes originais. */
const assinado = (corpo: unknown, recurso: string | null) =>
  processa(corpo, recurso, { assinada: true });

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

    const r = await assinado(
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

    await assinado(notificacao({ status: 'approved' }), RECURSO);

    expect(atualizados.some((a) => a.tabela === 'orders')).toBe(false);
  });

  // Nao conseguir confirmar nao e o mesmo que confirmar.
  it('provedor fora do ar pede reenvio, e nao muda nada', async () => {
    vi.mocked(consultaOrdem).mockResolvedValue(null);

    const r = await assinado(notificacao({ status: 'approved' }), RECURSO);

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

    await assinado(notificacao(), RECURSO);

    expect(passos[0]).toBe('registro');
  });

  it('evento repetido nao processa de novo', async () => {
    banco({ eventoRepetido: true });

    const r = await assinado(notificacao(), RECURSO);

    expect(r).toEqual({ tipo: 'ignorado', motivo: 'evento-repetido' });
    expect(consultaOrdem).not.toHaveBeenCalled();
    expect(atualizados).toEqual([]);
  });

  // O provedor reenvia a MESMA notificacao com o mesmo `id` de corpo. Usar o
  // `x-request-id`, que muda a cada entrega, faria cada reenvio parecer novo.
  it('a identidade do evento vem do corpo, nao da entrega', async () => {
    await assinado(notificacao({ id: 'evt-42' }), RECURSO);

    expect(inseridos.find((i) => i.tabela === 'pagamento_eventos')?.dados.evento_id).toBe('evt-42');
  });

  it('sem id no corpo, cai no id do recurso', async () => {
    await assinado({ data: { id: RECURSO } }, RECURSO);

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

    const r = await assinado(notificacao(), RECURSO);

    expect(r).toEqual({ tipo: 'ignorado', motivo: 'sem-avanco' });
    expect(atualizados.some((a) => a.tabela === 'pagamentos')).toBe(false);
  });

  it('o mesmo estado de novo nao e avanco', async () => {
    banco({ pagamento: { id: 'pag-1', order_id: 'ped-1', estado: 'aprovado' } });

    expect(await assinado(notificacao(), RECURSO)).toEqual({
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

    expect(await assinado(notificacao(), RECURSO)).toEqual({
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

    await assinado(notificacao(), RECURSO);

    expect(atualizados.find((a) => a.tabela === 'pagamento_eventos')?.dados.provedor_status).toBe(
      'action_required'
    );
  });
});

describe('efeito no pedido', () => {
  it('aprovado move o pedido para pago', async () => {
    await assinado(notificacao(), RECURSO);

    expect(atualizados.find((a) => a.tabela === 'orders')?.dados).toEqual({ status: 'pago' });
  });

  // O ponto da #100: recusa nao cancela o pedido, e cabe outra tentativa.
  it.each(['recusado', 'pendente', 'cancelado'] as const)('%s nao mexe no pedido', async (e) => {
    vi.mocked(consultaOrdem).mockResolvedValue({ estado: e, status: e, statusDetail: null });

    await assinado(notificacao(), RECURSO);

    expect(atualizados.some((a) => a.tabela === 'orders')).toBe(false);
  });
});

describe('recurso desconhecido', () => {
  it('registra o evento mesmo sem achar o pagamento', async () => {
    banco({ pagamento: null });

    const r = await assinado(notificacao(), RECURSO);

    expect(r).toEqual({ tipo: 'ignorado', motivo: 'pagamento-desconhecido' });
    // Ja ficou registrado: a conciliacao precisa saber que chegou.
    expect(inseridos.some((i) => i.tabela === 'pagamento_eventos')).toBe(true);
    expect(consultaOrdem).not.toHaveBeenCalled();
  });

  it('sem recurso nenhum nao registra nada', async () => {
    const r = await assinado({}, null);

    expect(r).toEqual({ tipo: 'ignorado', motivo: 'sem-recurso' });
    expect(inseridos).toEqual([]);
  });

  it('corpo nulo nao explode', async () => {
    expect((await assinado(null, null)).tipo).toBe('ignorado');
  });
});

/**
 * Sem assinatura valida. Com credencial de teste, a entrega real do provedor
 * vem assinada por uma aplicacao-espelho cujo segredo o painel nao mostra
 * (mercadopago/sdk-java#420). O caminho abaixo existe por isso, e cada teste
 * aqui e uma afirmacao de que ele e MAIS restrito que o assinado, nao menos.
 */
describe('sem assinatura', () => {
  const SANDBOX = 'ORDTST01ABC';
  const semAssinatura = (corpo: unknown, recurso: string | null) =>
    processa(corpo, recurso, { assinada: false });

  // A primeira linha: ordem real sem prova de origem nem chega ao banco.
  it('ordem real e recusada antes de tocar no banco', async () => {
    const r = await semAssinatura(notificacao(), 'ORD01REAL');

    expect(r).toEqual({ tipo: 'recusado', motivo: 'nao-assinado-fora-do-sandbox' });
    expect(clienteAdmin).not.toHaveBeenCalled();
    expect(consultaOrdem).not.toHaveBeenCalled();
  });

  // O prefixo tem que estar no INICIO. `xORDTST` ou um id que so contem a
  // palavra nao serve.
  it.each(['xORDTST01ABC', 'ORD01ORDTST', 'ordtst01abc'])('%s nao e sandbox', async (id) => {
    const r = await semAssinatura(notificacao(), id);

    expect(r.tipo).toBe('recusado');
    expect(clienteAdmin).not.toHaveBeenCalled();
  });

  it('ordem de teste conhecida e confirmada pelo provedor e aplicada', async () => {
    banco({ pagamento: { id: 'pag-1', order_id: 'ped-1', estado: 'pendente' } });

    const r = await semAssinatura(notificacao({ status: 'approved' }), SANDBOX);

    expect(consultaOrdem).toHaveBeenCalledWith(SANDBOX);
    expect(r).toEqual({ tipo: 'aplicado', estado: 'aprovado' });
    expect(atualizados.find((a) => a.tabela === 'orders')?.dados).toEqual({ status: 'pago' });
  });

  // O corpo continua nao decidindo nada — aqui ainda menos.
  it('corpo dizendo aprovado nao vale se o provedor disser pendente', async () => {
    vi.mocked(consultaOrdem).mockResolvedValue({
      estado: 'pendente',
      status: 'action_required',
      statusDetail: 'waiting_transfer',
    });

    await semAssinatura(notificacao({ status: 'approved' }), SANDBOX);

    expect(atualizados.some((a) => a.tabela === 'orders')).toBe(false);
  });

  // Ordem inversa da assinada, de proposito: nada gravado antes da confirmacao.
  it('consulta o provedor ANTES de gravar qualquer coisa', async () => {
    const passos: string[] = [];
    vi.mocked(consultaOrdem).mockImplementation(async () => {
      passos.push('consulta');
      return { estado: 'aprovado', status: 'processed', statusDetail: 'accredited' };
    });
    const original = inseridos.push.bind(inseridos);
    inseridos.push = ((...a: Parameters<typeof original>) => {
      passos.push('registro');
      return original(...a);
    }) as typeof inseridos.push;

    await semAssinatura(notificacao(), SANDBOX);

    expect(passos).toEqual(['consulta', 'registro']);
  });

  it('provedor fora do ar: nada gravado, pede reenvio', async () => {
    vi.mocked(consultaOrdem).mockResolvedValue(null);

    const r = await semAssinatura(notificacao(), SANDBOX);

    expect(r).toEqual({ tipo: 'tente-de-novo', motivo: 'nao-consegui-confirmar' });
    expect(inseridos).toEqual([]);
    expect(atualizados).toEqual([]);
  });

  // Quem nao provou nada nao ganha linha na auditoria.
  it('recurso desconhecido nao registra evento nem consulta', async () => {
    banco({ pagamento: null });

    const r = await semAssinatura(notificacao(), SANDBOX);

    expect(r).toEqual({ tipo: 'ignorado', motivo: 'pagamento-desconhecido' });
    expect(inseridos).toEqual([]);
    expect(consultaOrdem).not.toHaveBeenCalled();
  });

  // O ataque que o caminho assinado nao sofre e este sofreria: forjar um
  // corpo com o `id` que o provedor vai usar depois, para o evento real cair
  // como repetido. A identidade vem do provedor, entao o corpo nao escolhe.
  it('a identidade do evento vem do provedor, nao do corpo', async () => {
    await semAssinatura(notificacao({ id: 'id-escolhido-pelo-atacante' }), SANDBOX);

    const evento = inseridos.find((i) => i.tabela === 'pagamento_eventos');
    expect(evento?.dados.evento_id).toBe(`nao-assinado:${SANDBOX}:processed`);
    expect(evento?.dados.tipo).toBe('nao-assinado');
  });

  it('o mesmo estado de novo e repetido', async () => {
    banco({
      pagamento: { id: 'pag-1', order_id: 'ped-1', estado: 'aprovado' },
      eventoRepetido: true,
    });

    expect(await semAssinatura(notificacao(), SANDBOX)).toEqual({
      tipo: 'ignorado',
      motivo: 'evento-repetido',
    });
    expect(atualizados.some((a) => a.tabela === 'pagamentos')).toBe(false);
    expect(atualizados.some((a) => a.tabela === 'orders')).toBe(false);
  });

  // Evento ja registrado, estado que nao acompanhou: o repetido deduplica a
  // auditoria, nao a aplicacao. Senao um processo caindo entre gravar e
  // atualizar deixaria o pagamento preso para sempre.
  it('evento repetido com estado atrasado ainda aplica', async () => {
    banco({ eventoRepetido: true });

    expect(await semAssinatura(notificacao(), SANDBOX)).toEqual({
      tipo: 'aplicado',
      estado: 'aprovado',
    });
    expect(atualizados.find((a) => a.tabela === 'orders')?.dados).toEqual({ status: 'pago' });
  });

  it('pendente nao derruba aprovado, como no caminho assinado', async () => {
    banco({ pagamento: { id: 'pag-1', order_id: 'ped-1', estado: 'aprovado' } });
    vi.mocked(consultaOrdem).mockResolvedValue({
      estado: 'pendente',
      status: 'action_required',
      statusDetail: null,
    });

    const r = await semAssinatura(notificacao(), SANDBOX);

    expect(r).toEqual({ tipo: 'ignorado', motivo: 'sem-avanco' });
    expect(atualizados.some((a) => a.tabela === 'pagamentos')).toBe(false);
  });
});
