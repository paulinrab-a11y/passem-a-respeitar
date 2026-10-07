import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrdemEncontrada } from './orders-api';

/**
 * A barreira que mais se esquece: assinatura valida prova que a notificacao e
 * autentica, NAO que o `status` escrito nela ainda vale. Metade destes testes
 * existe para garantir que o corpo nunca decide dinheiro.
 */
const captureMessage = vi.fn();
vi.mock('@sentry/nextjs', () => ({
  captureMessage: (...a: unknown[]) => captureMessage(...a),
  flush: async () => true,
}));
vi.mock('@/lib/supabase/admin', () => ({ clienteAdmin: vi.fn() }));
vi.mock('./orders-api', () => ({
  consultaOrdem: vi.fn(),
  localizaOrdem: vi.fn(),
  buscaOrdensPorReferencia: vi.fn(),
  cancelaOrdem: vi.fn(),
  reembolsaOrdem: vi.fn(),
}));

const { clienteAdmin } = await import('@/lib/supabase/admin');
const { buscaOrdensPorReferencia, cancelaOrdem, consultaOrdem, localizaOrdem, reembolsaOrdem } =
  await import('./orders-api');
const { casaOrfa, encerraAbertas, estornaAprovadas, orfasDoPedido, processa } = await import(
  './webhook'
);

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
const CANCELADO = { estado: 'cancelado' as const, status: 'expired', statusDetail: null };
const CANCELADA = { ok: true as const, status: 'canceled', statusDetail: null };
const ESTORNADO = { estado: 'estornado' as const, status: 'refunded', statusDetail: 'refunded' };
const ESTORNADA = { ok: true as const, status: 'refunded', statusDetail: 'refunded' };

type Linha = {
  id: string;
  order_id: string;
  estado: string;
  provedor_pagamento_id: string | null;
  criado_em: string;
  idempotency_key?: string;
};

let inseridos: { tabela: string; dados: Record<string, unknown> }[] = [];
let atualizados: { tabela: string; dados: Record<string, unknown> }[] = [];
/** Cada consulta, com os filtros na ordem em que foram encadeados. */
let consultas: { tabela: string; ops: unknown[][] }[] = [];

/**
 * Aplica ao dublê os filtros que o banco aplicaria. So os que dizem respeito
 * a linhas: `select`, `order` e afins passam direto.
 */
function filtra(linhas: Linha[], ops: unknown[][]): Linha[] {
  return linhas.filter((l) =>
    ops.every(([op, coluna, ...resto]) => {
      const valor = l[coluna as keyof Linha];
      switch (op) {
        case 'eq':
          return valor === resto[0];
        case 'neq':
          return valor !== resto[0];
        case 'is':
          return valor === resto[0];
        case 'in':
          return (resto[0] as unknown[]).includes(valor);
        case 'not':
          return !(resto[0] === 'is' && valor === resto[1]);
        default:
          return true;
      }
    })
  );
}

function banco({
  pagamento = { id: 'pag-1', order_id: 'ped-1', estado: 'pendente' } as Record<
    string,
    unknown
  > | null,
  eventoRepetido = false,
  /** Todas as tentativas do pedido: o que `casaOrfa`, `orfasDoPedido` e `encerraAbertas` veem. */
  linhasDoPedido = [] as Linha[],
  /** O que o `update ... where id is null` do vinculo alcanca. */
  vinculo = 'alcanca' as 'alcanca' | 'ninguem' | 'duplicado',
  /** O pedido ainda esperava pagamento quando o `update` para `pago` chegou? */
  pedidoPendente = true,
  /** O status do pedido na releitura, quando o `update` nao alcancou nada. */
  statusDoPedido = 'pago' as string | null,
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
      elo.neq = anota('neq');
      elo.is = anota('is');
      elo.in = anota('in');
      elo.not = anota('not');
      elo.order = anota('order');
      elo.select = (...args: unknown[]) => {
        // `update ... select()`: devolve o que o filtro alcancou.
        if (emUpdate) {
          if (tabela === 'orders') {
            return Promise.resolve({ data: pedidoPendente ? [{ id: 'x' }] : [], error: null });
          }
          if (vinculo === 'duplicado') {
            return Promise.resolve({ data: null, error: { code: '23505' } });
          }
          return Promise.resolve({ data: vinculo === 'alcanca' ? [{ id: 'x' }] : [], error: null });
        }
        ops.push(['select', ...args]);
        return elo;
      };
      elo.maybeSingle = () =>
        Promise.resolve({
          data:
            tabela === 'orders' ? (statusDoPedido ? { status: statusDoPedido } : null) : pagamento,
          error: null,
        });
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
          data: tabela === 'pagamentos' && !emUpdate ? filtra(linhasDoPedido, ops) : null,
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

/** As mensagens que foram ao Sentry, na ordem. */
const avisos = () => captureMessage.mock.calls.map((c) => c[0]);

beforeEach(() => {
  vi.clearAllMocks();
  inseridos = [];
  atualizados = [];
  consultas = [];
  vi.mocked(consultaOrdem).mockResolvedValue(APROVADO);
  vi.mocked(localizaOrdem).mockResolvedValue({ ok: true, ordem: null });
  vi.mocked(buscaOrdensPorReferencia).mockResolvedValue({ ok: true, ordens: [] });
  vi.mocked(cancelaOrdem).mockResolvedValue(CANCELADA);
  vi.mocked(reembolsaOrdem).mockResolvedValue(ESTORNADA);
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

  // O pedido so anda se ainda espera (#11, #24). O filtro E a regra: um
  // cancelamento feito no meio nao e sobrescrito por `pago`.
  it('so move o pedido se ele ainda aguarda pagamento', async () => {
    await assinado(notificacao(), RECURSO);

    const update = consultas.find((c) => c.tabela === 'orders' && c.ops.length > 0);
    expect(update?.ops).toEqual(
      expect.arrayContaining([
        ['eq', 'id', 'ped-1'],
        ['eq', 'status', 'aguardando_pagamento'],
      ])
    );
  });

  /**
   * O dinheiro voltou pelo provedor — estorno pelo painel dele, chargeback —
   * e o pedido nao pode seguir "pago": o dono produziria uma camiseta cujo
   * valor ja nao esta com ele (#7).
   */
  describe('estorno no provedor', () => {
    beforeEach(() => {
      banco({ pagamento: { id: 'pag-1', order_id: 'ped-1', estado: 'aprovado' } });
      vi.mocked(consultaOrdem).mockResolvedValue(ESTORNADO);
    });

    it('estornado move o pedido para reembolsado e avisa o dono', async () => {
      const r = await assinado(notificacao(), RECURSO);

      expect(r).toEqual({ tipo: 'aplicado', estado: 'estornado' });
      expect(atualizados.find((a) => a.tabela === 'pagamentos')?.dados).toEqual({
        estado: 'estornado',
        provedor_status: 'refunded',
        provedor_status_detail: 'refunded',
      });
      expect(atualizados.find((a) => a.tabela === 'orders')?.dados).toEqual({
        status: 'reembolsado',
      });
      expect(captureMessage).toHaveBeenCalledWith(
        'pagamento estornado no provedor: pedido reembolsado',
        { level: 'warning', tags: { order_id: 'ped-1' } }
      );
    });

    // De onde se pode reembolsar, e de mais nenhum lugar: a mesma tabela que
    // o botao usa. Cancelado e reembolsado sao finais.
    it('so alcanca pedido pago, em producao, enviado ou entregue', async () => {
      await assinado(notificacao(), RECURSO);

      const update = consultas.find((c) => c.tabela === 'orders' && c.ops.length > 0);
      expect(update?.ops).toEqual(
        expect.arrayContaining([
          ['eq', 'id', 'ped-1'],
          ['in', 'status', ['pago', 'em_producao', 'enviado', 'entregue']],
        ])
      );
    });

    // O estorno pedido pelo botao ja mudou o pedido pela mao de quem apertou;
    // um pedido cancelado e final. Nos dois casos nada muda e ninguem e
    // acordado.
    it('pedido que ja nao esta nesses status fica como esta, sem aviso', async () => {
      banco({
        pagamento: { id: 'pag-1', order_id: 'ped-1', estado: 'aprovado' },
        pedidoPendente: false,
      });

      const r = await assinado(notificacao(), RECURSO);

      expect(r).toEqual({ tipo: 'aplicado', estado: 'estornado' });
      expect(avisos()).toEqual([]);
    });

    it('nao mexe nas irmas nem pede estorno de volta ao provedor', async () => {
      await assinado(notificacao(), RECURSO);

      expect(cancelaOrdem).not.toHaveBeenCalled();
      expect(reembolsaOrdem).not.toHaveBeenCalled();
    });

    it('o aviso leva so o id do pedido, em tag', async () => {
      await assinado(notificacao({ payer: { email: 'quem@exemplo.test' } }), RECURSO);

      expect(captureMessage.mock.calls[0]).toEqual([
        'pagamento estornado no provedor: pedido reembolsado',
        { level: 'warning', tags: { order_id: 'ped-1' } },
      ]);
      expect(JSON.stringify(captureMessage.mock.calls)).not.toContain('quem@exemplo.test');
    });

    /**
     * A #6 deixa duas tentativas `aprovado` no mesmo pedido e manda o dono
     * estornar a duplicada no painel do provedor. O estorno dela chega por
     * aqui — e o pedido, ainda sustentado pela outra, nao pode virar
     * `reembolsado`: e final, e o dono deixaria de produzir uma camiseta paga.
     */
    describe('estorno da duplicada', () => {
      const APROVADA = { id: 'pag-1', order_id: 'ped-1', estado: 'aprovado' };
      const IRMA_APROVADA: Linha = {
        id: 'pag-2',
        order_id: 'ped-1',
        estado: 'aprovado',
        provedor_pagamento_id: 'ORD-2',
        criado_em: em(T0),
      };

      it('deixa o pedido pago e avisa com mensagem propria', async () => {
        banco({ pagamento: APROVADA, linhasDoPedido: [IRMA_APROVADA] });

        const r = await assinado(notificacao({ payer: { email: 'quem@exemplo.test' } }), RECURSO);

        expect(r).toEqual({ tipo: 'aplicado', estado: 'estornado' });
        expect(atualizados.find((a) => a.tabela === 'pagamentos')?.dados).toEqual({
          estado: 'estornado',
          provedor_status: 'refunded',
          provedor_status_detail: 'refunded',
        });
        expect(atualizados.some((a) => a.tabela === 'orders')).toBe(false);
        expect(captureMessage.mock.calls).toEqual([
          [
            'pagamento duplicado estornado: pedido segue pago',
            { level: 'warning', tags: { order_id: 'ped-1' } },
          ],
        ]);
        expect(JSON.stringify(captureMessage.mock.calls)).not.toContain('quem@exemplo.test');
      });

      // O dublê nao reescreve a linha no `update`, entao a propria tentativa
      // ainda se le `aprovado` aqui: so o `neq` a tira da conta.
      it('a propria tentativa nao conta como irma', async () => {
        banco({ pagamento: APROVADA, linhasDoPedido: [{ ...IRMA_APROVADA, id: 'pag-1' }] });

        await assinado(notificacao(), RECURSO);

        const emPagamentos = consultas.filter((c) => c.tabela === 'pagamentos').map((c) => c.ops);
        expect(emPagamentos).toContainEqual(
          expect.arrayContaining([
            ['eq', 'order_id', 'ped-1'],
            ['eq', 'estado', 'aprovado'],
            ['neq', 'id', 'pag-1'],
          ])
        );
        expect(atualizados.find((a) => a.tabela === 'orders')?.dados).toEqual({
          status: 'reembolsado',
        });
        expect(avisos()).toEqual(['pagamento estornado no provedor: pedido reembolsado']);
      });

      // O dono estornou as duas no painel: a segunda notificacao ja nao acha
      // ninguem sustentando o pedido, e ai sim ele acompanha o dinheiro.
      it('irma ja estornada nao segura o pedido', async () => {
        banco({
          pagamento: APROVADA,
          linhasDoPedido: [{ ...IRMA_APROVADA, estado: 'estornado' }],
        });

        await assinado(notificacao(), RECURSO);

        expect(atualizados.find((a) => a.tabela === 'orders')?.dados).toEqual({
          status: 'reembolsado',
        });
        expect(avisos()).toEqual(['pagamento estornado no provedor: pedido reembolsado']);
      });
    });
  });
});

/**
 * O cenario da #6: Pix pendente e cartao aprovado no mesmo pedido. Quando uma
 * tentativa e aprovada, as outras ainda abertas sao canceladas aqui e no
 * provedor; e se outra ja estava aprovada, o cliente pagou duas vezes — e o
 * unico sinal e este, porque o pedido ja estava `pago` e nada mais muda.
 */
describe('uma cobranca aprovada por pedido', () => {
  const PIX: Linha = {
    id: 'pag-pix',
    order_id: 'ped-1',
    estado: 'pendente',
    provedor_pagamento_id: 'ORD-PIX',
    criado_em: em(T0),
    idempotency_key: 'chave-pix',
  };
  const JA_APROVADA: Linha = {
    ...PIX,
    id: 'pag-2',
    estado: 'aprovado',
    provedor_pagamento_id: 'ORD-2',
  };
  const canceladas = () =>
    atualizados.filter((a) => a.tabela === 'pagamentos' && a.dados.estado === 'cancelado');

  it('aprovado cancela, no provedor e aqui, a irma que ainda esperava', async () => {
    banco({ linhasDoPedido: [PIX] });

    const r = await assinado(notificacao(), RECURSO);

    expect(r).toEqual({ tipo: 'aplicado', estado: 'aprovado' });
    expect(cancelaOrdem).toHaveBeenCalledWith('ORD-PIX', expect.any(String));
    expect(canceladas().map((a) => a.dados)).toEqual([
      { estado: 'cancelado', provedor_status: 'canceled', provedor_status_detail: null },
    ]);
    expect(avisos()).toEqual([]);
  });

  it('procura as irmas abertas ou aprovadas do pedido, com id, menos a propria', async () => {
    banco({ linhasDoPedido: [PIX] });

    await assinado(notificacao(), RECURSO);

    const busca = consultas.find(
      (c) => c.tabela === 'pagamentos' && c.ops.some((o) => o[0] === 'neq')
    );
    expect(busca?.ops).toEqual(
      expect.arrayContaining([
        ['eq', 'order_id', 'ped-1'],
        ['in', 'estado', ['criado', 'pendente', 'aprovado']],
        ['not', 'provedor_pagamento_id', 'is', null],
        ['neq', 'id', 'pag-1'],
      ])
    );
  });

  // Cancelar la e so entao marcar aqui: marcar antes deixaria um QR pagavel
  // com cara de morto.
  it('cancela no provedor antes de marcar aqui', async () => {
    const passos: string[] = [];
    vi.mocked(cancelaOrdem).mockImplementation(async () => {
      passos.push('provedor');
      return CANCELADA;
    });
    banco({ linhasDoPedido: [PIX] });
    const original = atualizados.push.bind(atualizados);
    atualizados.push = ((...a: Parameters<typeof original>) => {
      if (a[0].dados.estado === 'cancelado') passos.push('banco');
      return original(...a);
    }) as typeof atualizados.push;

    await assinado(notificacao(), RECURSO);

    expect(passos).toEqual(['provedor', 'banco']);
  });

  // A marcacao aqui so alcanca o que ainda esta aberto: se um webhook aprovou
  // a irma no meio, nada e sobrescrito.
  it('a marcacao de cancelado so alcanca tentativa ainda aberta', async () => {
    banco({ linhasDoPedido: [PIX] });

    await assinado(notificacao(), RECURSO);

    const update = consultas.find(
      (c) => c.tabela === 'pagamentos' && c.ops.some((o) => o[0] === 'eq' && o[2] === 'pag-pix')
    );
    expect(update?.ops).toContainEqual(['in', 'estado', ['criado', 'pendente']]);
  });

  // Reenviar o cancelamento nao pode duplicar nada, e a chave nao pode ser a
  // da criacao: o provedor guarda a resposta por chave, e a da criacao
  // devolveria a ordem criada com cara de cancelada.
  it('a chave do cancelamento e estavel por tentativa, no formato de uuid, e nao e a da criacao', async () => {
    banco({ linhasDoPedido: [PIX] });
    await assinado(notificacao(), RECURSO);
    await assinado(notificacao(), RECURSO);

    const chaves = vi.mocked(cancelaOrdem).mock.calls.map((c) => c[1]);
    expect(chaves).toHaveLength(2);
    expect(chaves[0]).toBe(chaves[1]);
    expect(chaves[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(chaves[0]).not.toBe('chave-pix');
  });

  it('tentativas diferentes tem chaves de cancelamento diferentes', async () => {
    banco({
      linhasDoPedido: [
        PIX,
        { ...PIX, id: 'pag-3', provedor_pagamento_id: 'ORD-3', idempotency_key: 'chave-3' },
      ],
    });

    await assinado(notificacao(), RECURSO);

    const chaves = vi.mocked(cancelaOrdem).mock.calls.map((c) => c[1]);
    expect(new Set(chaves).size).toBe(2);
  });

  // Sem id nao ha o que cancelar, e marca-la `cancelado` a esconderia de
  // `casaOrfa` — se a ordem dela existe e for paga, e ai que se quer o aviso.
  it('irma sem id no provedor nao e tocada', async () => {
    banco({ linhasDoPedido: [{ ...PIX, estado: 'criado', provedor_pagamento_id: null }] });

    await assinado(notificacao(), RECURSO);

    expect(cancelaOrdem).not.toHaveBeenCalled();
    expect(canceladas()).toEqual([]);
  });

  it('recusado nao mexe nas irmas', async () => {
    banco({ linhasDoPedido: [PIX] });
    vi.mocked(consultaOrdem).mockResolvedValue(RECUSADO);

    await assinado(notificacao(), RECURSO);

    expect(cancelaOrdem).not.toHaveBeenCalled();
  });

  // O provedor recusa cancelar quando a ordem ja e final la. Entao se pergunta
  // o estado real e se aplica pelo mesmo caminho — e paga e o pagamento em
  // duplicidade da #6, que so aparece aqui.
  it('irma que o provedor nao deixa cancelar e ja estava paga la: aplica e avisa pagamento duplicado', async () => {
    banco({ linhasDoPedido: [PIX] });
    vi.mocked(cancelaOrdem).mockResolvedValue({ ok: false, motivo: 'invalido' });

    const r = await assinado(notificacao(), RECURSO);

    expect(r).toEqual({ tipo: 'aplicado', estado: 'aprovado' });
    expect(consultaOrdem).toHaveBeenCalledWith('ORD-PIX');
    const irma = atualizados.filter(
      (a) => a.tabela === 'pagamentos' && a.dados.estado === 'aprovado'
    );
    expect(irma).toHaveLength(2);
    expect(captureMessage).toHaveBeenCalledWith('pagamento duplicado a estornar', {
      level: 'error',
      tags: { order_id: 'ped-1' },
    });
    expect(inseridos.find((i) => i.dados.tipo === 'webhook')?.dados.evento_id).toBe(
      'webhook:ORD-PIX:processed'
    );
  });

  it('irma que o provedor nao deixa cancelar e ja expirou la: vira cancelado, sem aviso', async () => {
    banco({ linhasDoPedido: [PIX] });
    vi.mocked(cancelaOrdem).mockResolvedValue({ ok: false, motivo: 'invalido' });
    vi.mocked(consultaOrdem).mockResolvedValueOnce(APROVADO).mockResolvedValue(CANCELADO);

    await assinado(notificacao(), RECURSO);

    expect(canceladas().map((a) => a.dados)).toEqual([
      { estado: 'cancelado', provedor_status: 'expired', provedor_status_detail: null },
    ]);
    expect(avisos()).toEqual([]);
  });

  // Nao conseguir cancelar a irma nao pode custar a aprovacao desta. A irma
  // fica como esta: a conciliacao passa por ela depois.
  it('provedor fora do ar ao cancelar: a aprovacao vale e a irma fica como esta', async () => {
    banco({ linhasDoPedido: [PIX] });
    vi.mocked(cancelaOrdem).mockResolvedValue({ ok: false, motivo: 'indisponivel' });

    const r = await assinado(notificacao(), RECURSO);

    expect(r).toEqual({ tipo: 'aplicado', estado: 'aprovado' });
    expect(atualizados.find((a) => a.tabela === 'orders')?.dados).toEqual({ status: 'pago' });
    expect(consultaOrdem).toHaveBeenCalledTimes(1);
    expect(canceladas()).toEqual([]);
    expect(avisos()).toEqual([]);
  });

  it('segunda aprovacao no mesmo pedido avisa o dono, sem tocar na primeira', async () => {
    banco({ linhasDoPedido: [JA_APROVADA], pedidoPendente: false, statusDoPedido: 'pago' });

    const r = await assinado(notificacao(), RECURSO);

    expect(r).toEqual({ tipo: 'aplicado', estado: 'aprovado' });
    expect(cancelaOrdem).not.toHaveBeenCalled();
    expect(avisos()).toEqual(['pagamento duplicado a estornar']);
  });

  // O dono cancelou no meio e o dinheiro entrou mesmo assim: o pedido nao
  // volta para `pago` (cancelado e final), e isso ninguem descobre sozinho.
  it('aprovado em pedido que ja nao esperava pagamento nao grava pago e avisa', async () => {
    banco({ pedidoPendente: false, statusDoPedido: 'cancelado' });

    const r = await assinado(notificacao(), RECURSO);

    expect(r).toEqual({ tipo: 'aplicado', estado: 'aprovado' });
    expect(captureMessage).toHaveBeenCalledWith('pagamento aprovado em pedido nao pendente', {
      level: 'error',
      tags: { order_id: 'ped-1' },
    });
  });

  // Webhook e resposta sincrona correm. Se a outra via desta mesma cobranca
  // chegou antes, o pedido ja esta `pago` — e nao ha o que avisar.
  it('pedido que outra via desta cobranca ja marcou pago nao avisa', async () => {
    banco({ pedidoPendente: false, statusDoPedido: 'pago' });

    await assinado(notificacao(), RECURSO);

    expect(avisos()).toEqual([]);
  });

  it('pedido que sumiu avisa', async () => {
    banco({ pedidoPendente: false, statusDoPedido: null });

    await assinado(notificacao(), RECURSO);

    expect(avisos()).toEqual(['pagamento aprovado em pedido nao pendente']);
  });

  it('o aviso leva so o id do pedido, em tag', async () => {
    banco({ pedidoPendente: false, statusDoPedido: 'cancelado' });

    await assinado(notificacao({ payer: { email: 'quem@exemplo.test' } }), RECURSO);

    expect(captureMessage.mock.calls[0]).toEqual([
      'pagamento aprovado em pedido nao pendente',
      { level: 'error', tags: { order_id: 'ped-1' } },
    ]);
    expect(JSON.stringify(captureMessage.mock.calls)).not.toContain('quem@exemplo.test');
  });
});

/**
 * `encerraAbertas` sem excecao: a cobranca chama antes de abrir tentativa
 * nova, o dono chama ao cancelar o pedido. O que se prova aqui e a contagem,
 * porque e por ela que quem chama decide seguir, esperar ou recuar.
 */
describe('encerraAbertas', () => {
  const aberta = (id: string, extra: Partial<Linha> = {}): Linha => ({
    id: `pag-${id}`,
    order_id: 'ped-1',
    estado: 'pendente',
    provedor_pagamento_id: `ORD-${id}`,
    criado_em: em(T0),
    idempotency_key: `chave-${id}`,
    ...extra,
  });
  const encerra = () => encerraAbertas(clienteAdmin(), 'ped-1', 'cobranca');

  it('sem excecao, encerra todas as abertas com id', async () => {
    banco({ linhasDoPedido: [aberta('a'), aberta('b')] });

    expect(await encerra()).toEqual({ encerradas: 2, aprovadas: 0, presas: 0 });
    expect(vi.mocked(cancelaOrdem).mock.calls.map((c) => c[0])).toEqual(['ORD-a', 'ORD-b']);
  });

  it('sem nada aberto, nao chama o provedor', async () => {
    expect(await encerra()).toEqual({ encerradas: 0, aprovadas: 0, presas: 0 });
    expect(cancelaOrdem).not.toHaveBeenCalled();
  });

  it('a ja aprovada conta, e nao e tocada', async () => {
    banco({ linhasDoPedido: [aberta('a', { estado: 'aprovado' })] });

    expect(await encerra()).toEqual({ encerradas: 0, aprovadas: 1, presas: 0 });
    expect(cancelaOrdem).not.toHaveBeenCalled();
    expect(atualizados).toEqual([]);
  });

  it('provedor fora do ar ao cancelar: presa', async () => {
    banco({ linhasDoPedido: [aberta('a')] });
    vi.mocked(cancelaOrdem).mockResolvedValue({ ok: false, motivo: 'indisponivel' });

    expect(await encerra()).toEqual({ encerradas: 0, aprovadas: 0, presas: 1 });
    expect(consultaOrdem).not.toHaveBeenCalled();
  });

  it('provedor nao deixa cancelar e a consulta tambem falha: presa', async () => {
    banco({ linhasDoPedido: [aberta('a')] });
    vi.mocked(cancelaOrdem).mockResolvedValue({ ok: false, motivo: 'invalido' });
    vi.mocked(consultaOrdem).mockResolvedValue(null);

    expect(await encerra()).toEqual({ encerradas: 0, aprovadas: 0, presas: 1 });
  });

  // O provedor nao deixa, mas a consulta diz que continua pendente: nao ha
  // avanco a aplicar, e ela continua aberta.
  it('provedor nao deixa cancelar e ainda esta pendente la: presa', async () => {
    banco({ linhasDoPedido: [aberta('a')] });
    vi.mocked(cancelaOrdem).mockResolvedValue({ ok: false, motivo: 'invalido' });
    vi.mocked(consultaOrdem).mockResolvedValue({
      estado: 'pendente',
      status: 'action_required',
      statusDetail: null,
    });

    expect(await encerra()).toEqual({ encerradas: 0, aprovadas: 0, presas: 1 });
  });

  it('provedor nao deixa cancelar porque ja foi paga: aprovada, e o pedido vira pago', async () => {
    banco({ linhasDoPedido: [aberta('a')] });
    vi.mocked(cancelaOrdem).mockResolvedValue({ ok: false, motivo: 'invalido' });

    expect(await encerra()).toEqual({ encerradas: 0, aprovadas: 1, presas: 0 });
    expect(atualizados.find((a) => a.tabela === 'orders')?.dados).toEqual({ status: 'pago' });
    expect(inseridos[0]?.dados).toMatchObject({
      evento_id: 'cobranca:ORD-a:processed',
      tipo: 'cobranca',
      pagamento_id: 'pag-a',
    });
  });

  it('provedor nao deixa cancelar porque ja expirou: encerrada', async () => {
    banco({ linhasDoPedido: [aberta('a')] });
    vi.mocked(cancelaOrdem).mockResolvedValue({ ok: false, motivo: 'invalido' });
    vi.mocked(consultaOrdem).mockResolvedValue(CANCELADO);

    expect(await encerra()).toEqual({ encerradas: 1, aprovadas: 0, presas: 0 });
    expect(atualizados.find((a) => a.tabela === 'pagamentos')?.dados.estado).toBe('cancelado');
  });

  // O provedor nao TEM a ordem (id do sandbox com a credencial de producao, por
  // exemplo). Antes isso caia em "nao deixa cancelar" e a consulta tambem nao
  // achava: presa para sempre, e o pedido nem pagavel nem cancelavel.
  it('cobranca cujo id o provedor nao tem e encerrada, nao presa', async () => {
    banco({ linhasDoPedido: [aberta('a')] });
    vi.mocked(cancelaOrdem).mockResolvedValue({ ok: false, motivo: 'inexistente' });
    vi.mocked(localizaOrdem).mockResolvedValue({ ok: true, ordem: null });

    expect(await encerra()).toEqual({ encerradas: 1, aprovadas: 0, presas: 0 });
    expect(localizaOrdem).toHaveBeenCalledWith('ORD-a');
    expect(atualizados).toEqual([
      {
        tabela: 'pagamentos',
        dados: { estado: 'cancelado', provedor_status_detail: 'order_not_found' },
      },
    ]);
    // So alcanca tentativa ainda aberta, como o cancelamento normal.
    const marcacao = consultas.find(
      (c) => c.tabela === 'pagamentos' && c.ops.length > 0 && c.ops[0][0] === 'eq'
    );
    expect(marcacao?.ops).toEqual([
      ['eq', 'id', 'pag-a'],
      ['in', 'estado', ['criado', 'pendente']],
    ]);
    expect(inseridos).toEqual([]);
    expect(avisos()).toEqual([]);
  });

  // Um 404 sozinho nao enterra uma cobranca: sem a consulta confirmar, espera.
  it('provedor diz nao ter a ordem mas a consulta falha: presa', async () => {
    banco({ linhasDoPedido: [aberta('a')] });
    vi.mocked(cancelaOrdem).mockResolvedValue({ ok: false, motivo: 'inexistente' });
    vi.mocked(localizaOrdem).mockResolvedValue({ ok: false });

    expect(await encerra()).toEqual({ encerradas: 0, aprovadas: 0, presas: 1 });
    expect(atualizados).toEqual([]);
  });

  it('provedor diz nao ter a ordem mas a consulta a acha paga: aprovada, e o pedido vira pago', async () => {
    banco({ linhasDoPedido: [aberta('a')] });
    vi.mocked(cancelaOrdem).mockResolvedValue({ ok: false, motivo: 'inexistente' });
    vi.mocked(localizaOrdem).mockResolvedValue({
      ok: true,
      ordem: { provedorId: 'ORD-a', referencia: 'ped-1', criadaEmMs: T0, resumo: APROVADO },
    });

    expect(await encerra()).toEqual({ encerradas: 0, aprovadas: 1, presas: 0 });
    expect(consultaOrdem).not.toHaveBeenCalled();
    expect(atualizados.find((a) => a.tabela === 'orders')?.dados).toEqual({ status: 'pago' });
    expect(inseridos[0]?.dados).toMatchObject({
      evento_id: 'cobranca:ORD-a:processed',
      pagamento_id: 'pag-a',
    });
  });

  it('provedor diz nao ter a ordem mas a consulta a acha pendente: presa', async () => {
    banco({ linhasDoPedido: [aberta('a')] });
    vi.mocked(cancelaOrdem).mockResolvedValue({ ok: false, motivo: 'inexistente' });
    vi.mocked(localizaOrdem).mockResolvedValue({
      ok: true,
      ordem: {
        provedorId: 'ORD-a',
        referencia: 'ped-1',
        criadaEmMs: T0,
        resumo: { estado: 'pendente', status: 'action_required', statusDetail: null },
      },
    });

    expect(await encerra()).toEqual({ encerradas: 0, aprovadas: 0, presas: 1 });
  });

  // Uma por vez: rajada no provedor e o que o limite deles pune.
  it('uma por vez, nunca em rajada', async () => {
    banco({ linhasDoPedido: [aberta('a'), aberta('b'), aberta('c')] });
    let emVoo = 0;
    let maximo = 0;
    vi.mocked(cancelaOrdem).mockImplementation(async () => {
      emVoo += 1;
      maximo = Math.max(maximo, emVoo);
      await new Promise((r) => setTimeout(r, 5));
      emVoo -= 1;
      return CANCELADA;
    });

    await encerra();

    expect(maximo).toBe(1);
  });
});

/**
 * O botao "Reembolsar" chama isto ANTES de mudar o status (#22): estorna no
 * provedor, marca aqui, e quem chama so muda o pedido se nada ficou presa
 * nem recusada. O que se prova e a contagem — e por ela que a acao decide —
 * e a ordem: provedor primeiro, banco depois.
 */
describe('estornaAprovadas', () => {
  const aprovada = (id: string, extra: Partial<Linha> = {}): Linha => ({
    id: `pag-${id}`,
    order_id: 'ped-1',
    estado: 'aprovado',
    provedor_pagamento_id: `ORD-${id}`,
    criado_em: em(T0),
    idempotency_key: `chave-${id}`,
    ...extra,
  });
  const estorna = () => estornaAprovadas(clienteAdmin(), 'ped-1');
  const marcadas = () =>
    atualizados.filter((a) => a.tabela === 'pagamentos' && a.dados.estado === 'estornado');
  const NADA = { estornadas: 0, jaEstornadas: 0, recusadas: 0, presas: 0 };

  it('estorna no provedor cada aprovada com id, e marca aqui com o status cru', async () => {
    banco({ linhasDoPedido: [aprovada('a')] });

    expect(await estorna()).toEqual({ ...NADA, estornadas: 1 });
    expect(reembolsaOrdem).toHaveBeenCalledWith('ORD-a', expect.any(String));
    expect(marcadas().map((a) => a.dados)).toEqual([
      { estado: 'estornado', provedor_status: 'refunded', provedor_status_detail: 'refunded' },
    ]);
  });

  it('procura as aprovadas e as ja estornadas do pedido, com id', async () => {
    banco({ linhasDoPedido: [aprovada('a')] });

    await estorna();

    expect(consultas.find((c) => c.tabela === 'pagamentos')?.ops).toEqual([
      ['select', 'id, order_id, estado, provedor_pagamento_id, idempotency_key'],
      ['eq', 'order_id', 'ped-1'],
      ['in', 'estado', ['aprovado', 'estornado']],
      ['not', 'provedor_pagamento_id', 'is', null],
    ]);
  });

  // Estornar la e so entao marcar aqui: marcar antes deixaria o pedido
  // "reembolsado" com o dinheiro na conta — o que o botao fazia.
  it('estorna no provedor antes de marcar aqui', async () => {
    const passos: string[] = [];
    vi.mocked(reembolsaOrdem).mockImplementation(async () => {
      passos.push('provedor');
      return ESTORNADA;
    });
    banco({ linhasDoPedido: [aprovada('a')] });
    const original = atualizados.push.bind(atualizados);
    atualizados.push = ((...a: Parameters<typeof original>) => {
      if (a[0].dados.estado === 'estornado') passos.push('banco');
      return original(...a);
    }) as typeof atualizados.push;

    await estorna();

    expect(passos).toEqual(['provedor', 'banco']);
  });

  // Se a notificacao do estorno chegou no meio e ja marcou, nada e sobrescrito.
  it('a marcacao so alcanca tentativa ainda aprovada', async () => {
    banco({ linhasDoPedido: [aprovada('a')] });

    await estorna();

    const update = consultas.find(
      (c) => c.tabela === 'pagamentos' && c.ops.some((o) => o[0] === 'eq' && o[2] === 'pag-a')
    );
    expect(update?.ops).toEqual([
      ['eq', 'id', 'pag-a'],
      ['eq', 'estado', 'aprovado'],
    ]);
  });

  // Tentar de novo depois de uma falha no meio reusa a chave e nao estorna
  // duas vezes. E a chave nao e a da criacao nem a do cancelamento: o
  // provedor guarda a resposta por chave.
  it('a chave e estavel por tentativa, em formato de uuid, e nao e a da criacao nem a do cancelamento', async () => {
    banco({ linhasDoPedido: [aprovada('a')] });
    await estorna();
    await estorna();

    const chaves = vi.mocked(reembolsaOrdem).mock.calls.map((c) => c[1]);
    expect(chaves).toHaveLength(2);
    expect(chaves[0]).toBe(chaves[1]);
    expect(chaves[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(chaves[0]).not.toBe('chave-a');

    // A mesma tentativa, cancelada em vez de estornada, usa outra chave.
    banco({ linhasDoPedido: [aprovada('a', { estado: 'pendente' })] });
    await encerraAbertas(clienteAdmin(), 'ped-1', 'admin');
    expect(vi.mocked(cancelaOrdem).mock.calls[0]?.[1]).not.toBe(chaves[0]);
  });

  // Duas aprovadas e o pagamento em duplicidade da #6: as duas voltam.
  it('duas aprovadas: as duas voltam, uma por vez', async () => {
    banco({ linhasDoPedido: [aprovada('a'), aprovada('b')] });
    let emVoo = 0;
    let maximo = 0;
    vi.mocked(reembolsaOrdem).mockImplementation(async () => {
      emVoo += 1;
      maximo = Math.max(maximo, emVoo);
      await new Promise((r) => setTimeout(r, 5));
      emVoo -= 1;
      return ESTORNADA;
    });

    expect(await estorna()).toEqual({ ...NADA, estornadas: 2 });
    expect(vi.mocked(reembolsaOrdem).mock.calls.map((c) => c[0])).toEqual(['ORD-a', 'ORD-b']);
    expect(maximo).toBe(1);
  });

  // O dinheiro ja tinha voltado por outro caminho (painel do provedor, e o
  // webhook refletiu): nao se estorna de novo, mas quem chama fica sabendo.
  it('a ja estornada so e contada, sem chamar o provedor', async () => {
    banco({ linhasDoPedido: [aprovada('a', { estado: 'estornado' })] });

    expect(await estorna()).toEqual({ ...NADA, jaEstornadas: 1 });
    expect(reembolsaOrdem).not.toHaveBeenCalled();
    expect(atualizados).toEqual([]);
  });

  it('sem aprovada nem estornada, zeros e nenhuma chamada', async () => {
    banco({
      linhasDoPedido: [
        aprovada('a', { estado: 'pendente' }),
        aprovada('b', { estado: 'recusado' }),
      ],
    });

    expect(await estorna()).toEqual(NADA);
    expect(reembolsaOrdem).not.toHaveBeenCalled();
  });

  it('provedor fora do ar: presa, e nada e marcado', async () => {
    banco({ linhasDoPedido: [aprovada('a')] });
    vi.mocked(reembolsaOrdem).mockResolvedValue({ ok: false, motivo: 'indisponivel' });

    expect(await estorna()).toEqual({ ...NADA, presas: 1 });
    expect(atualizados).toEqual([]);
    expect(consultaOrdem).not.toHaveBeenCalled();
  });

  // O provedor recusa porque a ordem ja foi estornada pelo painel dele: a
  // consulta confirma, a linha acompanha, e conta como feita.
  it('provedor nao deixa porque ja esta estornada la: marca e conta como feita', async () => {
    banco({ linhasDoPedido: [aprovada('a')] });
    vi.mocked(reembolsaOrdem).mockResolvedValue({ ok: false, motivo: 'invalido' });
    vi.mocked(consultaOrdem).mockResolvedValue(ESTORNADO);

    expect(await estorna()).toEqual({ ...NADA, estornadas: 1 });
    expect(consultaOrdem).toHaveBeenCalledWith('ORD-a');
    expect(marcadas().map((a) => a.dados)).toEqual([
      { estado: 'estornado', provedor_status: 'refunded', provedor_status_detail: 'refunded' },
    ]);
  });

  it('provedor nao deixa e a ordem segue paga la: recusada, e nada e marcado', async () => {
    banco({ linhasDoPedido: [aprovada('a')] });
    vi.mocked(reembolsaOrdem).mockResolvedValue({ ok: false, motivo: 'invalido' });

    expect(await estorna()).toEqual({ ...NADA, recusadas: 1 });
    expect(atualizados).toEqual([]);
  });

  it('provedor nao deixa e a consulta falha: presa', async () => {
    banco({ linhasDoPedido: [aprovada('a')] });
    vi.mocked(reembolsaOrdem).mockResolvedValue({ ok: false, motivo: 'invalido' });
    vi.mocked(consultaOrdem).mockResolvedValue(null);

    expect(await estorna()).toEqual({ ...NADA, presas: 1 });
  });

  // Nao ha como devolver o que o provedor nao conhece.
  it('ordem que o provedor nao tem: recusada', async () => {
    banco({ linhasDoPedido: [aprovada('a')] });
    vi.mocked(reembolsaOrdem).mockResolvedValue({ ok: false, motivo: 'inexistente' });

    expect(await estorna()).toEqual({ ...NADA, recusadas: 1 });
    expect(atualizados).toEqual([]);
  });

  // Nada aqui passa por `aplica`: o pedido vai mudar pela mao de quem
  // apertou, com autor e motivo, e a automacao nao toma o lugar dela.
  it('nao registra evento, nao mexe no pedido e nao avisa: isso e de quem apertou', async () => {
    banco({ linhasDoPedido: [aprovada('a')] });

    await estorna();

    expect(inseridos).toEqual([]);
    expect(atualizados.some((a) => a.tabela === 'orders')).toBe(false);
    expect(avisos()).toEqual([]);
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
    banco({ pagamento: null, linhasDoPedido: [ORFA] });
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

  // Todas as tentativas, nao so a mais recente sem id: qual e a dona se decide
  // pela epoca, e a epoca de cada uma termina onde a seguinte comeca.
  it('procura as tentativas do pedido da referencia, da mais nova para a mais velha', async () => {
    await assinado(notificacao(), RECURSO);

    const busca = consultas.find(
      (c) => c.tabela === 'pagamentos' && c.ops.some((o) => o[0] === 'eq' && o[1] === 'order_id')
    );
    expect(busca?.ops).toEqual([
      ['select', 'id, order_id, estado, provedor_pagamento_id, criado_em'],
      ['eq', 'order_id', 'ped-1'],
      ['order', 'tentativa', { ascending: false }],
    ]);
  });

  // O cenario que o pareamento por posicao errava: a tentativa mais recente
  // nunca chegou ao provedor, e a ordem notificada e da anterior.
  it('webhook de ordem antiga casa com a orfa da sua epoca, nao com a mais recente', async () => {
    const MAIS_NOVA: Linha = { ...ORFA, id: 'pag-10', criado_em: em(T0 + seg(90)) };
    banco({ pagamento: null, linhasDoPedido: [MAIS_NOVA, ORFA] });

    const r = await assinado(notificacao(), RECURSO);

    expect(r).toEqual({ tipo: 'aplicado', estado: 'aprovado' });
    const vinculo = consultas.find(
      (c) => c.tabela === 'pagamentos' && c.ops.some((o) => o[0] === 'eq' && o[1] === 'id')
    );
    expect(vinculo?.ops).toContainEqual(['eq', 'id', 'pag-9']);
    expect(atualizados.find((a) => a.tabela === 'pagamento_eventos')?.dados).toMatchObject({
      pagamento_id: 'pag-9',
    });
  });

  it('ordem nascida na epoca da tentativa mais recente fica com ela', async () => {
    const MAIS_NOVA: Linha = { ...ORFA, id: 'pag-10', criado_em: em(T0 + seg(90)) };
    banco({ pagamento: null, linhasDoPedido: [MAIS_NOVA, ORFA] });
    vi.mocked(localizaOrdem).mockResolvedValue({
      ok: true,
      ordem: ordem({ criadaEmMs: T0 + seg(92) }),
    });

    await assinado(notificacao(), RECURSO);

    expect(atualizados.find((a) => a.tabela === 'pagamento_eventos')?.dados).toMatchObject({
      pagamento_id: 'pag-10',
    });
  });

  // A tentativa seguinte tem id, entao a ordem dela e conhecida e nao chegaria
  // aqui; uma ordem desconhecida nascida na epoca dela nao e de ninguem.
  it('ordem nascida na epoca de uma tentativa que ja tem id nao e de orfa nenhuma', async () => {
    const COM_ID: Linha = {
      ...ORFA,
      id: 'pag-10',
      estado: 'pendente',
      provedor_pagamento_id: 'ORD-X',
      criado_em: em(T0 + seg(90)),
    };
    banco({ pagamento: null, linhasDoPedido: [COM_ID, ORFA] });
    vi.mocked(localizaOrdem).mockResolvedValue({
      ok: true,
      ordem: ordem({ criadaEmMs: T0 + seg(92) }),
    });

    expect(await assinado(notificacao(), RECURSO)).toEqual({
      tipo: 'ignorado',
      motivo: 'pagamento-desconhecido',
    });
    expect(atualizados).toEqual([]);
  });

  it('ordem sem data fica com a orfa mais recente', async () => {
    const MAIS_NOVA: Linha = { ...ORFA, id: 'pag-10', criado_em: em(T0 + seg(90)) };
    banco({ pagamento: null, linhasDoPedido: [MAIS_NOVA, ORFA] });
    vi.mocked(localizaOrdem).mockResolvedValue({ ok: true, ordem: ordem({ criadaEmMs: null }) });

    await assinado(notificacao(), RECURSO);

    expect(atualizados.find((a) => a.tabela === 'pagamento_eventos')?.dados).toMatchObject({
      pagamento_id: 'pag-10',
    });
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
    banco({ pagamento: null, linhasDoPedido: [{ ...ORFA, estado: 'recusado' }] });

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
    banco({ pagamento: null, linhasDoPedido: [ORFA], vinculo: 'ninguem' });

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

  it('duas orfas e duas ordens: cada uma fica com a da sua epoca', async () => {
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

  // O cenario que o pareamento por posicao errava: a mais nova nunca chegou
  // ao provedor; parear por posicao dava a ela a unica ordem (e a recusava
  // pela data) e deixava a mais velha sem nada — ate aprovada, invisivel, e a
  // proxima cobranca cobrava de novo.
  it('orfa mais nova sem ordem nao rouba a vez da mais velha', async () => {
    const MAIS_NOVA = linha('pag-3', T0 + seg(90));
    banco({ linhasDoPedido: [MAIS_NOVA, ORFA] });
    vi.mocked(buscaOrdensPorReferencia).mockResolvedValue({
      ok: true,
      ordens: [ordem('ORD-B', T0 + seg(2))],
    });

    expect(await casa(ORFA)).toEqual({ tipo: 'aplicado', estado: 'aprovado' });
    expect(atualizados.find((a) => a.tabela === 'pagamentos')?.dados).toEqual({
      provedor_pagamento_id: 'ORD-B',
    });
    expect(atualizados.find((a) => a.tabela === 'orders')?.dados).toEqual({ status: 'pago' });

    atualizados = [];
    expect(await casa(MAIS_NOVA)).toEqual({ tipo: 'ignorado', motivo: 'sem-ordem-no-provedor' });
    expect(atualizados).toEqual([]);
  });

  // A epoca de uma tentativa termina onde a seguinte comeca — seja a seguinte
  // orfa ou nao. Recusada sem id, a ordem dela nao tem dona na tabela e
  // apareceria na busca; mesmo assim nao e desta.
  it('ordem nascida na epoca da tentativa seguinte nao e desta', async () => {
    const RECUSADA_DEPOIS = linha('pag-3', T0 + seg(70), { estado: 'recusado' });
    banco({ linhasDoPedido: [RECUSADA_DEPOIS, ORFA] });
    vi.mocked(buscaOrdensPorReferencia).mockResolvedValue({
      ok: true,
      ordens: [ordem('ORD-C', T0 + seg(71), RECUSADO)],
    });

    expect(await casa()).toEqual({ tipo: 'ignorado', motivo: 'sem-ordem-no-provedor' });
    expect(atualizados).toEqual([]);
  });

  // Cartao recusado e tentativa nova tres segundos depois: a ordem da recusada
  // cai na folga de relogio da orfa. Entre as duas, a mais nova e a desta.
  it('na borda com uma tentativa recusada logo antes, a ordem mais nova e a desta', async () => {
    const RECUSADA_ANTES = linha('pag-1', T0 - seg(3), { estado: 'recusado' });
    banco({ linhasDoPedido: [ORFA, RECUSADA_ANTES] });
    vi.mocked(buscaOrdensPorReferencia).mockResolvedValue({
      ok: true,
      ordens: [ordem('ORD-A', T0 - seg(2), RECUSADO), ordem('ORD-B', T0 + seg(1))],
    });

    expect(await casa()).toEqual({ tipo: 'aplicado', estado: 'aprovado' });
    expect(atualizados.find((a) => a.tabela === 'pagamentos')?.dados).toEqual({
      provedor_pagamento_id: 'ORD-B',
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

describe('orfasDoPedido', () => {
  const linhaOrfa = (id: string, extra: Partial<Linha> = {}): Linha => ({
    id,
    order_id: 'ped-1',
    estado: 'criado',
    provedor_pagamento_id: null,
    criado_em: em(T0),
    ...extra,
  });

  // Todas, nao so a mais recente: a cobranca confere cada uma antes de abrir
  // tentativa nova, porque a mais recente pode nunca ter chegado ao provedor.
  it('procura as tentativas sem id, em aberto, da mais nova para a mais velha', async () => {
    const ORFAS = [linhaOrfa('pag-10'), linhaOrfa('pag-9')];
    banco({ linhasDoPedido: ORFAS });

    expect(await orfasDoPedido(clienteAdmin(), 'ped-1')).toEqual(ORFAS);
    expect(consultas.find((c) => c.tabela === 'pagamentos')?.ops).toEqual([
      ['select', 'id, order_id, estado, criado_em'],
      ['eq', 'order_id', 'ped-1'],
      ['is', 'provedor_pagamento_id', null],
      ['in', 'estado', ['criado', 'pendente']],
      ['order', 'tentativa', { ascending: false }],
    ]);
  });

  it('tentativa com id, ou ja recusada, fica de fora', async () => {
    banco({
      linhasDoPedido: [
        linhaOrfa('pag-10', { estado: 'recusado' }),
        linhaOrfa('pag-9', { estado: 'pendente', provedor_pagamento_id: 'ORD-A' }),
      ],
    });

    expect(await orfasDoPedido(clienteAdmin(), 'ped-1')).toEqual([]);
  });

  it('sem tentativa em aberto, nada', async () => {
    expect(await orfasDoPedido(clienteAdmin(), 'ped-1')).toEqual([]);
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
