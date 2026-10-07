import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrdemEncontrada } from './orders-api';

/**
 * A barreira que mais se esquece: assinatura valida prova que a notificacao e
 * autentica, NAO que o `status` escrito nela ainda vale. Metade destes testes
 * existe para garantir que o corpo nunca decide dinheiro.
 */
vi.mock('@/lib/supabase/admin', () => ({ clienteAdmin: vi.fn() }));
vi.mock('./orders-api', () => ({
  consultaOrdem: vi.fn(),
  localizaOrdem: vi.fn(),
  buscaOrdensPorReferencia: vi.fn(),
}));

const { clienteAdmin } = await import('@/lib/supabase/admin');
const { buscaOrdensPorReferencia, consultaOrdem, localizaOrdem } = await import('./orders-api');
const { casaOrfa, orfaDoPedido, processa } = await import('./webhook');

/** Caminho assinado — o dos testes originais. */
const assinado = (corpo: unknown, recurso: string | null) =>
  processa(corpo, recurso, { assinada: true });

const RECURSO = 'ORD01ABC';

/** Instante de referencia das tentativas sem id. O relogio real nao entra. */
const T0 = Date.parse('2026-10-07T12:00:00Z');
const seg = (n: number) => n * 1000;
const em = (ms: number) => new Date(ms).toISOString();

const APROVADO = { estado: 'aprovado' as const, status: 'processed', statusDetail: 'accredited' };
const RECUSADO = { estado: 'recusado' as const, status: 'failed', statusDetail: 'cc_rejected' };

type Linha = {
  id: string;
  order_id: string;
  estado: string;
  provedor_pagamento_id: string | null;
  criado_em: string;
};

let inseridos: { tabela: string; dados: Record<string, unknown> }[] = [];
let atualizados: { tabela: string; dados: Record<string, unknown> }[] = [];
/** Cada consulta, com os filtros na ordem em que foram encadeados. */
let consultas: { tabela: string; ops: unknown[][] }[] = [];

function banco({
  pagamento = { id: 'pag-1', order_id: 'ped-1', estado: 'pendente' } as Record<
    string,
    unknown
  > | null,
  eventoRepetido = false,
  /** O que `orfaDoPedido` encontra. */
  orfa = null as Linha | null,
  /** Todas as tentativas do pedido, para `casaOrfa`. */
  linhasDoPedido = [] as Linha[],
  /** O que o `update ... where id is null` do vinculo alcanca. */
  vinculo = 'alcanca' as 'alcanca' | 'ninguem' | 'duplicado',
}) {
  vi.mocked(clienteAdmin).mockReturnValue({
    from(tabela: string) {
      const ops: unknown[][] = [];
      let emUpdate = false;
      consultas.push({ tabela, ops });

      const elo: Record<string, unknown> = {};
      const anota =
        (op: string) =>
        (...args: unknown[]) => {
          ops.push([op, ...args]);
          return elo;
        };
      elo.eq = anota('eq');
      elo.is = anota('is');
      elo.in = anota('in');
      elo.order = anota('order');
      elo.select = (...args: unknown[]) => {
        // `update ... select()` do vinculo: devolve o que o filtro alcancou.
        if (emUpdate) {
          if (vinculo === 'duplicado') {
            return Promise.resolve({ data: null, error: { code: '23505' } });
          }
          return Promise.resolve({ data: vinculo === 'alcanca' ? [{ id: 'x' }] : [], error: null });
        }
        ops.push(['select', ...args]);
        return elo;
      };
      elo.maybeSingle = () => Promise.resolve({ data: pagamento, error: null });
      elo.limit = (n: number) => {
        ops.push(['limit', n]);
        return Promise.resolve({ data: orfa ? [orfa] : [], error: null });
      };
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
        emUpdate = true;
        return elo;
      };
      // Consulta sem terminal proprio (`select ... order`): o `await` cai aqui,
      // como no builder de verdade do Supabase, que tambem e thenable.
      // biome-ignore lint/suspicious/noThenProperty: o dublê imita um builder thenable
      elo.then = (resolve: (v: unknown) => void) =>
        resolve({
          data: tabela === 'pagamentos' && !emUpdate ? linhasDoPedido : null,
          error: null,
        });
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
  consultas = [];
  vi.mocked(consultaOrdem).mockResolvedValue(APROVADO);
  vi.mocked(localizaOrdem).mockResolvedValue({ ok: true, ordem: null });
  vi.mocked(buscaOrdensPorReferencia).mockResolvedValue({ ok: true, ordens: [] });
  banco({});
});

describe('o corpo nao decide nada', () => {
  // O ataque classico: notificacao assinada de verdade, com o status trocado.
  it('ignora o status que veio no corpo e consulta o provedor', async () => {
    vi.mocked(consultaOrdem).mockResolvedValue(RECUSADO);

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
      return APROVADO;
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

  // O reenvio existe para isto: a entrega anterior pode ter morrido entre
  // registrar o evento e aplicar (consulta ao provedor que falhou, processo
  // derrubado). Encerrar no repetido deixaria o pagamento preso ate a
  // conciliacao, horas depois. (#15)
  it('evento repetido reconsulta o provedor e aplica o que faltou', async () => {
    banco({ eventoRepetido: true });

    const r = await assinado(notificacao(), RECURSO);

    expect(consultaOrdem).toHaveBeenCalledWith(RECURSO);
    expect(r).toEqual({ tipo: 'aplicado', estado: 'aprovado' });
    expect(atualizados.find((a) => a.tabela === 'orders')?.dados).toEqual({ status: 'pago' });
  });

  it('evento repetido sem nada novo continua contando como repetido', async () => {
    banco({
      pagamento: { id: 'pag-1', order_id: 'ped-1', estado: 'aprovado' },
      eventoRepetido: true,
    });

    const r = await assinado(notificacao(), RECURSO);

    expect(r).toEqual({ tipo: 'ignorado', motivo: 'evento-repetido' });
    expect(atualizados.some((a) => a.tabela === 'pagamentos')).toBe(false);
    expect(atualizados.some((a) => a.tabela === 'orders')).toBe(false);
  });

  it('evento repetido com provedor fora do ar pede reenvio de novo', async () => {
    banco({ eventoRepetido: true });
    vi.mocked(consultaOrdem).mockResolvedValue(null);

    expect(await assinado(notificacao(), RECURSO)).toEqual({
      tipo: 'tente-de-novo',
      motivo: 'nao-consegui-confirmar',
    });
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

  it('provedor fora do ar ao localizar a ordem pede reenvio', async () => {
    banco({ pagamento: null });
    vi.mocked(localizaOrdem).mockResolvedValue({ ok: false });

    const r = await assinado(notificacao(), RECURSO);

    expect(r).toEqual({ tipo: 'tente-de-novo', motivo: 'nao-consegui-confirmar' });
    expect(atualizados).toEqual([]);
  });
});

/**
 * O caso real da #5/#14: a cobranca estourou o prazo, a linha ficou `criado`
 * sem id, e o provedor — que processou mesmo assim — avisa por aqui. A ordem
 * dele traz o `external_reference`, que e o id do pedido.
 */
describe('recurso desconhecido que e de uma tentativa sem id', () => {
  const ORFA: Linha = {
    id: 'pag-9',
    order_id: 'ped-1',
    estado: 'criado',
    provedor_pagamento_id: null,
    criado_em: em(T0),
  };
  const ordem = (extra: Partial<OrdemEncontrada> = {}): OrdemEncontrada => ({
    provedorId: RECURSO,
    referencia: 'ped-1',
    criadaEmMs: T0 + seg(2),
    resumo: APROVADO,
    ...extra,
  });

  beforeEach(() => {
    banco({ pagamento: null, orfa: ORFA });
    vi.mocked(localizaOrdem).mockResolvedValue({ ok: true, ordem: ordem() });
  });

  it('casa pela referencia, preenche o id e aplica', async () => {
    const r = await assinado(notificacao(), RECURSO);

    expect(localizaOrdem).toHaveBeenCalledWith(RECURSO);
    expect(r).toEqual({ tipo: 'aplicado', estado: 'aprovado' });

    const pagamentos = atualizados.filter((a) => a.tabela === 'pagamentos').map((a) => a.dados);
    expect(pagamentos[0]).toEqual({ provedor_pagamento_id: RECURSO });
    expect(pagamentos[1]?.estado).toBe('aprovado');
    expect(atualizados.find((a) => a.tabela === 'orders')?.dados).toEqual({ status: 'pago' });
  });

  it('procura a tentativa sem id, em aberto, mais recente do pedido da referencia', async () => {
    await assinado(notificacao(), RECURSO);

    const busca = consultas.find(
      (c) => c.tabela === 'pagamentos' && c.ops.some((o) => o[0] === 'is')
    );
    expect(busca?.ops).toEqual(
      expect.arrayContaining([
        ['eq', 'order_id', 'ped-1'],
        ['is', 'provedor_pagamento_id', null],
        ['in', 'estado', ['criado', 'pendente']],
        ['order', 'tentativa', { ascending: false }],
        ['limit', 1],
      ])
    );
  });

  // O evento foi registrado sem saber de quem era. Agora se sabe.
  it('o evento registrado ganha o pagamento que casou', async () => {
    await assinado(notificacao(), RECURSO);

    expect(atualizados.find((a) => a.tabela === 'pagamento_eventos')?.dados).toEqual({
      pagamento_id: 'pag-9',
      provedor_status: 'processed',
    });
  });

  it('o estado vem da ordem localizada, nao do corpo', async () => {
    vi.mocked(localizaOrdem).mockResolvedValue({
      ok: true,
      ordem: ordem({
        resumo: { estado: 'pendente', status: 'action_required', statusDetail: 'waiting_transfer' },
      }),
    });

    const r = await assinado(notificacao({ status: 'approved' }), RECURSO);

    expect(r).toEqual({ tipo: 'aplicado', estado: 'pendente' });
    expect(atualizados.some((a) => a.tabela === 'orders')).toBe(false);
  });

  // A linha nasce antes da chamada, entao a ordem dela nasce depois da linha.
  it('ordem mais velha que a tentativa nao e dela', async () => {
    vi.mocked(localizaOrdem).mockResolvedValue({
      ok: true,
      ordem: ordem({ criadaEmMs: T0 - seg(60) }),
    });

    const r = await assinado(notificacao(), RECURSO);

    expect(r).toEqual({ tipo: 'ignorado', motivo: 'pagamento-desconhecido' });
    expect(atualizados).toEqual([]);
  });

  it('ordem sem referencia nossa continua desconhecida', async () => {
    vi.mocked(localizaOrdem).mockResolvedValue({ ok: true, ordem: ordem({ referencia: null }) });

    expect(await assinado(notificacao(), RECURSO)).toEqual({
      tipo: 'ignorado',
      motivo: 'pagamento-desconhecido',
    });
    expect(atualizados).toEqual([]);
  });

  it('pedido da referencia sem tentativa em aberto continua desconhecido', async () => {
    banco({ pagamento: null, orfa: null });

    expect(await assinado(notificacao(), RECURSO)).toEqual({
      tipo: 'ignorado',
      motivo: 'pagamento-desconhecido',
    });
    expect(atualizados).toEqual([]);
  });

  it('ordem que o provedor nao tem e so desconhecida, nao erro', async () => {
    vi.mocked(localizaOrdem).mockResolvedValue({ ok: true, ordem: null });

    expect(await assinado(notificacao(), RECURSO)).toEqual({
      tipo: 'ignorado',
      motivo: 'pagamento-desconhecido',
    });
  });

  // Webhook, conciliacao e cobranca podem chegar juntos. O `is null` no
  // update garante que so o primeiro vincula; os outros nao sobrescrevem.
  it('se outro caminho vinculou no meio, nao sobrescreve nem aplica', async () => {
    banco({ pagamento: null, orfa: ORFA, vinculo: 'ninguem' });

    const r = await assinado(notificacao(), RECURSO);

    expect(r).toEqual({ tipo: 'ignorado', motivo: 'ja-vinculado' });
    expect(atualizados.some((a) => 'estado' in a.dados)).toBe(false);
    expect(atualizados.some((a) => a.tabela === 'orders')).toBe(false);
  });
});

/**
 * A tentativa sem id reencontra a ordem dela pelo `external_reference`. A
 * cobranca chama antes de abrir tentativa nova; a conciliacao, pela cauda
 * longa. O que se prova aqui e o pareamento: qual ordem e de qual tentativa.
 */
describe('casaOrfa', () => {
  const T1 = T0 - seg(90);
  const AGORA = T0 + seg(60);

  const linha = (id: string, criadoEmMs: number, extra: Partial<Linha> = {}): Linha => ({
    id,
    order_id: 'ped-1',
    estado: 'criado',
    provedor_pagamento_id: null,
    criado_em: em(criadoEmMs),
    ...extra,
  });
  const ordem = (
    provedorId: string,
    criadaEmMs: number,
    resumo: OrdemEncontrada['resumo'] = APROVADO
  ): OrdemEncontrada => ({
    provedorId,
    referencia: 'ped-1',
    criadaEmMs,
    resumo,
  });
  const ORFA = linha('pag-2', T0);

  const casa = (orfa: Linha = ORFA, origem: 'cobranca' | 'conciliacao' = 'cobranca') =>
    casaOrfa(clienteAdmin(), orfa, origem, AGORA);

  it('vincula a ordem sem dona e aplica o estado dela', async () => {
    banco({ linhasDoPedido: [ORFA] });
    vi.mocked(buscaOrdensPorReferencia).mockResolvedValue({
      ok: true,
      ordens: [ordem('ORD-B', T0 + seg(3))],
    });

    const r = await casa();

    expect(r).toEqual({ tipo: 'aplicado', estado: 'aprovado' });
    const pagamentos = atualizados.filter((a) => a.tabela === 'pagamentos').map((a) => a.dados);
    expect(pagamentos[0]).toEqual({ provedor_pagamento_id: 'ORD-B' });
    expect(pagamentos[1]?.estado).toBe('aprovado');
    expect(atualizados.find((a) => a.tabela === 'orders')?.dados).toEqual({ status: 'pago' });
  });

  it('o evento diz quem casou e com qual ordem', async () => {
    banco({ linhasDoPedido: [ORFA] });
    vi.mocked(buscaOrdensPorReferencia).mockResolvedValue({
      ok: true,
      ordens: [ordem('ORD-B', T0 + seg(3))],
    });

    await casa(ORFA, 'conciliacao');

    expect(inseridos[0]?.dados).toMatchObject({
      evento_id: 'conciliacao:ORD-B:processed',
      tipo: 'conciliacao',
      pagamento_id: 'pag-2',
    });
  });

  it('a busca cobre da orfa mais velha ate agora, com folga de relogio', async () => {
    banco({ linhasDoPedido: [ORFA, linha('pag-1', T1)] });

    await casa();

    expect(buscaOrdensPorReferencia).toHaveBeenCalledWith('ped-1', {
      desdeMs: T1 - seg(5),
      ateMs: AGORA + seg(5),
    });
  });

  it('busca fora do ar pede reenvio, e nada e gravado', async () => {
    banco({ linhasDoPedido: [ORFA] });
    vi.mocked(buscaOrdensPorReferencia).mockResolvedValue({ ok: false });

    expect(await casa()).toEqual({ tipo: 'tente-de-novo', motivo: 'nao-consegui-confirmar' });
    expect(atualizados).toEqual([]);
    expect(inseridos).toEqual([]);
  });

  it('sem ordem sem dona no provedor, nada muda', async () => {
    banco({ linhasDoPedido: [ORFA] });

    expect(await casa()).toEqual({ tipo: 'ignorado', motivo: 'sem-ordem-no-provedor' });
    expect(atualizados).toEqual([]);
  });

  // Toda tentativa manda o mesmo external_reference, entao a busca devolve
  // as ordens de todas elas — inclusive a que ja tem dona.
  it('ordem que ja tem dona em outra linha nao e reaproveitada', async () => {
    banco({
      linhasDoPedido: [
        ORFA,
        linha('pag-1', T1, { estado: 'pendente', provedor_pagamento_id: 'ORD-A' }),
      ],
    });
    vi.mocked(buscaOrdensPorReferencia).mockResolvedValue({
      ok: true,
      ordens: [ordem('ORD-A', T1 + seg(2))],
    });

    expect(await casa()).toEqual({ tipo: 'ignorado', motivo: 'sem-ordem-no-provedor' });
    expect(atualizados).toEqual([]);
  });

  it('ordem que nasceu antes da orfa nao e dela', async () => {
    banco({ linhasDoPedido: [ORFA] });
    vi.mocked(buscaOrdensPorReferencia).mockResolvedValue({
      ok: true,
      ordens: [ordem('ORD-A', T0 - seg(60))],
    });

    expect(await casa()).toEqual({ tipo: 'ignorado', motivo: 'sem-ordem-no-provedor' });
    expect(atualizados).toEqual([]);
  });

  it('duas orfas e duas ordens: cada uma fica com a da sua vez', async () => {
    const MAIS_NOVA = linha('pag-3', T0 + seg(40));
    banco({ linhasDoPedido: [MAIS_NOVA, ORFA] });
    // Fora de ordem de proposito: quem ordena e o codigo, pela data.
    vi.mocked(buscaOrdensPorReferencia).mockResolvedValue({
      ok: true,
      ordens: [ordem('ORD-B', T0 + seg(2)), ordem('ORD-C', T0 + seg(42))],
    });

    await casa(ORFA);
    expect(atualizados.find((a) => a.tabela === 'pagamentos')?.dados).toEqual({
      provedor_pagamento_id: 'ORD-B',
    });

    atualizados = [];
    await casa(MAIS_NOVA);
    expect(atualizados.find((a) => a.tabela === 'pagamentos')?.dados).toEqual({
      provedor_pagamento_id: 'ORD-C',
    });
  });

  it('orfa que ja ganhou id no meio do caminho nao e tocada', async () => {
    banco({ linhasDoPedido: [linha('pag-2', T0, { provedor_pagamento_id: 'ORD-B' })] });

    expect(await casa()).toEqual({ tipo: 'ignorado', motivo: 'ja-vinculado' });
    expect(buscaOrdensPorReferencia).not.toHaveBeenCalled();
  });

  it('vinculo que outro caminho fez antes nao aplica nada', async () => {
    banco({ linhasDoPedido: [ORFA], vinculo: 'ninguem' });
    vi.mocked(buscaOrdensPorReferencia).mockResolvedValue({
      ok: true,
      ordens: [ordem('ORD-B', T0 + seg(3))],
    });

    expect(await casa()).toEqual({ tipo: 'ignorado', motivo: 'ja-vinculado' });
    expect(inseridos).toEqual([]);
    expect(atualizados.some((a) => 'estado' in a.dados)).toBe(false);
  });

  it('id que ja esta em outra linha e corrida perdida, nao erro', async () => {
    banco({ linhasDoPedido: [ORFA], vinculo: 'duplicado' });
    vi.mocked(buscaOrdensPorReferencia).mockResolvedValue({
      ok: true,
      ordens: [ordem('ORD-B', T0 + seg(3))],
    });

    expect(await casa()).toEqual({ tipo: 'ignorado', motivo: 'ja-vinculado' });
  });

  it('recusada do outro lado vira recusado aqui, sem mexer no pedido', async () => {
    banco({ linhasDoPedido: [ORFA] });
    vi.mocked(buscaOrdensPorReferencia).mockResolvedValue({
      ok: true,
      ordens: [ordem('ORD-B', T0 + seg(3), RECUSADO)],
    });

    expect(await casa()).toEqual({ tipo: 'aplicado', estado: 'recusado' });
    expect(atualizados.some((a) => a.tabela === 'orders')).toBe(false);
  });

  // A resposta pode ter vindo sem id e ainda assim dizer "pendente".
  it('tentativa pendente sem id tambem e orfa', async () => {
    const PENDENTE = linha('pag-2', T0, { estado: 'pendente' });
    banco({ linhasDoPedido: [PENDENTE] });
    vi.mocked(buscaOrdensPorReferencia).mockResolvedValue({
      ok: true,
      ordens: [ordem('ORD-B', T0 + seg(3))],
    });

    expect(await casa(PENDENTE)).toEqual({ tipo: 'aplicado', estado: 'aprovado' });
  });
});

describe('orfaDoPedido', () => {
  it('procura a tentativa sem id, em aberto, mais recente', async () => {
    const ORFA = linhaOrfa();
    banco({ orfa: ORFA });

    expect(await orfaDoPedido(clienteAdmin(), 'ped-1')).toEqual(ORFA);
    expect(consultas.find((c) => c.tabela === 'pagamentos')?.ops).toEqual([
      ['select', 'id, order_id, estado, criado_em'],
      ['eq', 'order_id', 'ped-1'],
      ['is', 'provedor_pagamento_id', null],
      ['in', 'estado', ['criado', 'pendente']],
      ['order', 'tentativa', { ascending: false }],
      ['limit', 1],
    ]);
  });

  it('sem tentativa em aberto, nada', async () => {
    expect(await orfaDoPedido(clienteAdmin(), 'ped-1')).toBeNull();
  });

  function linhaOrfa(): Linha {
    return {
      id: 'pag-9',
      order_id: 'ped-1',
      estado: 'criado',
      provedor_pagamento_id: null,
      criado_em: em(T0),
    };
  }
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
      return APROVADO;
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

  // Quem nao provou nada nao ganha linha na auditoria — nem busca pela
  // referencia: isso e so para quem veio assinado.
  it('recurso desconhecido nao registra evento nem consulta', async () => {
    banco({ pagamento: null });

    const r = await semAssinatura(notificacao(), SANDBOX);

    expect(r).toEqual({ tipo: 'ignorado', motivo: 'pagamento-desconhecido' });
    expect(inseridos).toEqual([]);
    expect(consultaOrdem).not.toHaveBeenCalled();
    expect(localizaOrdem).not.toHaveBeenCalled();
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
