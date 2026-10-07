import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Supabase e Mercado Pago trocados por dublês. O que se prova e a costura:
 * corpo do request entra, e o que chega no provedor e o valor do BANCO.
 *
 * As barreiras do banco estao conferidas contra o Supabase real e anotadas no
 * PR; a chamada de verdade ao Mercado Pago foi feita com credencial de teste.
 *
 * `casaOrfa` e `orfaDoPedido` tambem sao dublês: o que e deles (achar a ordem
 * no provedor, vincular, aplicar) se prova em webhook.test.ts. Aqui se prova
 * a DECISAO da cobranca diante do que eles respondem. Ja `encerraAbertas` e
 * `marcaPago` rodam de verdade, com o provedor dublado: o que se prova e que
 * a cobranca nova nao nasce com outra viva, e que aprovar nao atropela um
 * pedido que ja nao esperava.
 */
const captureMessage = vi.fn();
vi.mock('@sentry/nextjs', () => ({
  captureMessage: (...a: unknown[]) => captureMessage(...a),
  flush: async () => true,
}));
vi.mock('@/lib/supabase/servidor', () => ({ usuarioDaSessao: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ clienteAdmin: vi.fn() }));
vi.mock('./orders-api', () => ({
  criaOrdem: vi.fn(),
  cancelaOrdem: vi.fn(),
  consultaOrdem: vi.fn(),
  localizaOrdem: vi.fn(),
  buscaOrdensPorReferencia: vi.fn(),
}));
vi.mock('./webhook', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./webhook')>()),
  casaOrfa: vi.fn(),
  orfaDoPedido: vi.fn(),
}));

const { usuarioDaSessao } = await import('@/lib/supabase/servidor');
const { clienteAdmin } = await import('@/lib/supabase/admin');
const { cancelaOrdem, consultaOrdem, criaOrdem } = await import('./orders-api');
const { casaOrfa, orfaDoPedido } = await import('./webhook');
const { cobra } = await import('./cobranca');

const USUARIO = { id: 'uuu-1', email: 'quem@exemplo.test' };
const PEDIDO = '11111111-2222-4333-8444-555555555555';

/** Um Pix que ficou esperando no provedor: a tentativa aberta tipica. */
const PIX_ABERTO = {
  id: 'pag-pix',
  order_id: PEDIDO,
  estado: 'pendente',
  provedor_pagamento_id: 'ORD-PIX',
  idempotency_key: 'chave-pix',
};
const CANCELADA = { ok: true as const, status: 'canceled', statusDetail: null };

/** O que cada tabela recebeu, para conferir o que foi gravado. */
let gravado: { tabela: string; dados: Record<string, unknown> }[] = [];
let atualizado: { tabela: string; dados: Record<string, unknown> }[] = [];
/** Cada consulta, com os filtros na ordem em que foram encadeados. */
let consultas: { tabela: string; ops: unknown[][] }[] = [];

/**
 * Aplica ao dublê os filtros por linha que o banco aplicaria. Sem isto, a
 * busca das irmas "menos a propria" devolveria a propria para sempre.
 */
function filtra(linhas: Record<string, unknown>[], ops: unknown[][]) {
  return linhas.filter((l) =>
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
}

function banco({
  pedido = { id: PEDIDO, total_centavos: 12000, status: 'aguardando_pagamento' },
  ultimaTentativa = null as number | null,
  falhaAoInserir = false,
  /** Tentativas do pedido abertas no provedor, ou ja aprovadas. */
  abertas = [] as Record<string, unknown>[],
  /** O pedido ainda esperava pagamento quando a aprovacao chegou? */
  pedidoPendente = true,
  /** O status do pedido na releitura, quando o `update` nao alcancou nada. */
  statusDepois = 'pago' as string | null,
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
      elo.in = anota('in');
      elo.not = anota('not');
      elo.order = anota('order');
      elo.select = (...args: unknown[]) => {
        // `update ... select()` do pedido: devolve o que o filtro alcancou.
        if (emUpdate) {
          return Promise.resolve({ data: pedidoPendente ? [{ id: 'x' }] : [], error: null });
        }
        ops.push(['select', ...args]);
        return elo;
      };
      elo.limit = () =>
        Promise.resolve({
          data: ultimaTentativa === null ? [] : [{ tentativa: ultimaTentativa }],
          error: null,
        });
      elo.maybeSingle = () => {
        // A releitura depois de aprovar pede so o status; a leitura do pedido
        // pede o resto.
        const releitura = ops.some((o) => o[0] === 'select' && o[1] === 'status');
        return Promise.resolve({
          data: releitura ? (statusDepois ? { status: statusDepois } : null) : pedido,
          error: null,
        });
      };
      elo.single = () =>
        Promise.resolve(
          falhaAoInserir
            ? { data: null, error: { code: '23505' } }
            : { data: { id: 'pag-1', idempotency_key: 'chave-estavel-1' }, error: null }
        );
      elo.insert = (dados: Record<string, unknown>) => {
        gravado.push({ tabela, dados });
        return elo;
      };
      elo.update = (dados: Record<string, unknown>) => {
        atualizado.push({ tabela, dados });
        emUpdate = true;
        return elo;
      };
      // Consulta sem terminal proprio (as tentativas abertas): o `await` cai
      // aqui, como no builder de verdade do Supabase, que tambem e thenable.
      // biome-ignore lint/suspicious/noThenProperty: o dublê imita um builder thenable
      elo.then = (resolve: (v: unknown) => void) =>
        resolve({
          data: tabela === 'pagamentos' && !emUpdate ? filtra(abertas, ops) : null,
          error: null,
        });
      return elo;
    },
  } as never);
}

const pixOk = {
  ok: true as const,
  provedorId: 'mp-1',
  resumo: {
    estado: 'pendente' as const,
    status: 'action_required',
    statusDetail: 'waiting_transfer',
  },
  pix: { copiaECola: '00020126...', qrBase64: 'iVBOR', expiraEm: null },
};

beforeEach(() => {
  vi.clearAllMocks();
  gravado = [];
  atualizado = [];
  consultas = [];
  vi.mocked(usuarioDaSessao).mockResolvedValue(USUARIO as never);
  vi.mocked(criaOrdem).mockResolvedValue(pixOk);
  vi.mocked(cancelaOrdem).mockResolvedValue(CANCELADA);
  vi.mocked(orfaDoPedido).mockResolvedValue(null);
  banco({});
});

const pedirPix = (extra: Record<string, unknown> = {}) =>
  cobra({ pedido: PEDIDO, payment_method_id: 'pix', ...extra });

describe('o valor vem do banco', () => {
  // O teste central da #110.
  it('ignora valor adulterado no corpo', async () => {
    await pedirPix({
      amount: 1,
      total_amount: '1.00',
      totalCentavos: 100,
      transaction_amount: 1,
      valor_centavos: 100,
    });

    expect(vi.mocked(criaOrdem).mock.calls[0][0].totalCentavos).toBe(12000);
  });

  it('grava na tentativa o valor do banco', async () => {
    await pedirPix({ valor_centavos: 1 });

    const pagamento = gravado.find((g) => g.tabela === 'pagamentos');
    expect(pagamento?.dados.valor_centavos).toBe(12000);
  });

  it('nao repassa campo que o schema nao declara', async () => {
    await pedirPix({ amount: 1, external_reference: 'outro', capture: false });

    const enviado = vi.mocked(criaOrdem).mock.calls[0][0];
    expect(Object.keys(enviado).sort()).toEqual([
      'documento',
      'email',
      'idempotencia',
      'metodo',
      'pedidoId',
      'totalCentavos',
    ]);
  });

  it('o e-mail vem da sessao, nao do corpo', async () => {
    await pedirPix({ payer: { email: 'outro@exemplo.test' } });

    expect(vi.mocked(criaOrdem).mock.calls[0][0].email).toBe(USUARIO.email);
  });
});

describe('idempotencia', () => {
  // O ponto: a linha nasce ANTES da chamada, e a chave sai dela.
  it('a linha e gravada antes de falar com o provedor', async () => {
    let ordemDosPassos: string[] = [];
    vi.mocked(criaOrdem).mockImplementation(async () => {
      ordemDosPassos.push('provedor');
      return pixOk;
    });
    banco({});
    gravado = [];
    ordemDosPassos = [];

    const original = gravado.push.bind(gravado);
    gravado.push = ((...a: Parameters<typeof original>) => {
      ordemDosPassos.push('banco');
      return original(...a);
    }) as typeof gravado.push;

    await pedirPix();

    expect(ordemDosPassos).toEqual(['banco', 'provedor']);
  });

  it('a chave enviada e a da linha, nao uma nova', async () => {
    await pedirPix();

    expect(vi.mocked(criaOrdem).mock.calls[0][0].idempotencia).toBe('chave-estavel-1');
  });

  it('conta a tentativa a partir da ultima', async () => {
    banco({ ultimaTentativa: 3 });
    await pedirPix();

    expect(gravado.find((g) => g.tabela === 'pagamentos')?.dados.tentativa).toBe(4);
  });

  // Conflito no indice unico (order_id, tentativa): dois cliques ao mesmo
  // tempo. A recusa E a protecao contra cobranca duplicada.
  it('clique duplo bate no indice unico e nao cobra', async () => {
    banco({ falhaAoInserir: true });

    expect(await pedirPix()).toEqual({ ok: false, motivo: 'indisponivel' });
    expect(criaOrdem).not.toHaveBeenCalled();
  });

  it('para no teto de tentativas', async () => {
    banco({ ultimaTentativa: 20 });

    expect(await pedirPix()).toEqual({ ok: false, motivo: 'tentativas-demais' });
    expect(criaOrdem).not.toHaveBeenCalled();
  });
});

/**
 * O cenario da #5/#14: a cobranca estourou o prazo, a linha ficou `criado`
 * sem id, e a pessoa clica de novo. Abrir outra ordem agora e cobrar o cartao
 * duas vezes — entao primeiro se pergunta ao provedor o que houve com a
 * anterior, e a resposta dele decide.
 */
describe('tentativa anterior sem resposta', () => {
  const orfaCom = (idadeMs: number) => ({
    id: 'pag-orfa',
    order_id: PEDIDO,
    estado: 'criado',
    criado_em: new Date(Date.now() - idadeMs).toISOString(),
  });
  const RECENTE = 10 * 1000;
  const ANTIGA = 5 * 60 * 1000;

  it('sem orfa, segue direto para a cobranca', async () => {
    await pedirPix();

    expect(casaOrfa).not.toHaveBeenCalled();
    expect(criaOrdem).toHaveBeenCalledTimes(1);
  });

  it('orfa aprovada do outro lado: nenhuma ordem nova, e o pedido ja esta pago', async () => {
    const orfa = orfaCom(RECENTE);
    vi.mocked(orfaDoPedido).mockResolvedValue(orfa);
    vi.mocked(casaOrfa).mockResolvedValue({ tipo: 'aplicado', estado: 'aprovado' });

    const r = await pedirPix();

    expect(casaOrfa).toHaveBeenCalledWith(expect.anything(), orfa, 'cobranca');
    expect(r).toEqual({ ok: true, estado: 'aprovado' });
    expect(gravado).toEqual([]);
    expect(criaOrdem).not.toHaveBeenCalled();
  });

  // Pendente la, a orfa ganhou id ao casar — e passa a ser uma tentativa
  // aberta como outra qualquer: e encerrada para a nova nascer sem deixar QR
  // vivo (#6). Devolve-la como "a que vale" deixaria a pessoa sem o QR, que
  // se perdeu junto com a resposta.
  it('orfa ainda pendente la ganha id e e encerrada antes da nova', async () => {
    vi.mocked(orfaDoPedido).mockResolvedValue(orfaCom(RECENTE));
    vi.mocked(casaOrfa).mockResolvedValue({ tipo: 'aplicado', estado: 'pendente' });
    banco({ abertas: [PIX_ABERTO] });

    const r = await pedirPix();

    expect(cancelaOrdem).toHaveBeenCalledWith('ORD-PIX', expect.any(String));
    expect(r.ok).toBe(true);
    expect(criaOrdem).toHaveBeenCalledTimes(1);
  });

  it.each(['recusado', 'cancelado'] as const)(
    'orfa %s do outro lado morreu: cabe tentativa nova',
    async (estado) => {
      vi.mocked(orfaDoPedido).mockResolvedValue(orfaCom(RECENTE));
      vi.mocked(casaOrfa).mockResolvedValue({ tipo: 'aplicado', estado });

      const r = await pedirPix();

      expect(r.ok).toBe(true);
      expect(gravado.some((g) => g.tabela === 'pagamentos')).toBe(true);
      expect(criaOrdem).toHaveBeenCalledTimes(1);
    }
  );

  // Nao conseguir perguntar nao e o mesmo que "nao existe". Esperar e a
  // unica resposta que nao arrisca cobrar duas vezes.
  it('provedor fora do ar ao perguntar: espera, nao cobra', async () => {
    vi.mocked(orfaDoPedido).mockResolvedValue(orfaCom(ANTIGA));
    vi.mocked(casaOrfa).mockResolvedValue({
      tipo: 'tente-de-novo',
      motivo: 'nao-consegui-confirmar',
    });

    expect(await pedirPix()).toEqual({ ok: false, motivo: 'pagamento-em-processamento' });
    expect(gravado).toEqual([]);
    expect(criaOrdem).not.toHaveBeenCalled();
  });

  it('outro caminho vinculando agora mesmo: espera', async () => {
    vi.mocked(orfaDoPedido).mockResolvedValue(orfaCom(ANTIGA));
    vi.mocked(casaOrfa).mockResolvedValue({ tipo: 'ignorado', motivo: 'ja-vinculado' });

    expect(await pedirPix()).toEqual({ ok: false, motivo: 'pagamento-em-processamento' });
    expect(criaOrdem).not.toHaveBeenCalled();
  });

  // A busca do provedor pode nao enxergar na hora o que acabou de nascer la.
  it('orfa recente que o provedor ainda nao mostra: espera', async () => {
    vi.mocked(orfaDoPedido).mockResolvedValue(orfaCom(RECENTE));
    vi.mocked(casaOrfa).mockResolvedValue({ tipo: 'ignorado', motivo: 'sem-ordem-no-provedor' });

    expect(await pedirPix()).toEqual({ ok: false, motivo: 'pagamento-em-processamento' });
    expect(criaOrdem).not.toHaveBeenCalled();
  });

  it('orfa antiga que o provedor nunca viu: nunca chegou la, cabe tentativa nova', async () => {
    vi.mocked(orfaDoPedido).mockResolvedValue(orfaCom(ANTIGA));
    vi.mocked(casaOrfa).mockResolvedValue({ tipo: 'ignorado', motivo: 'sem-ordem-no-provedor' });

    const r = await pedirPix();

    expect(r.ok).toBe(true);
    expect(criaOrdem).toHaveBeenCalledTimes(1);
  });

  // Uma cobranca que ja aconteceu vale mais que o teto de tentativas.
  it('a orfa e conferida antes de contar tentativas', async () => {
    banco({ ultimaTentativa: 20 });
    vi.mocked(orfaDoPedido).mockResolvedValue(orfaCom(RECENTE));
    vi.mocked(casaOrfa).mockResolvedValue({ tipo: 'aplicado', estado: 'aprovado' });

    expect(await pedirPix()).toEqual({ ok: true, estado: 'aprovado' });
  });
});

/**
 * O cenario da #6: a pessoa gera um Pix, desiste e paga com cartao. O QR do
 * Pix continua vivo no provedor — pago depois, e dinheiro em duplicidade. Entao
 * a cobranca anterior e cancelada la ANTES de a nova nascer; se nao der para
 * cancelar, nao se abre outra.
 */
describe('uma cobranca viva por pedido', () => {
  const pedirCartao = () =>
    cobra({ pedido: PEDIDO, payment_method_id: 'master', token: 'tok12345678', installments: 1 });

  it('sem cobranca aberta, nao cancela nada', async () => {
    await pedirCartao();

    expect(cancelaOrdem).not.toHaveBeenCalled();
    expect(criaOrdem).toHaveBeenCalledTimes(1);
  });

  it('com Pix pendente, cancela no provedor e marca cancelado antes de abrir a nova', async () => {
    banco({ abertas: [PIX_ABERTO] });

    const r = await pedirCartao();

    expect(r.ok).toBe(true);
    expect(cancelaOrdem).toHaveBeenCalledWith('ORD-PIX', expect.any(String));
    expect(atualizado[0]).toEqual({
      tabela: 'pagamentos',
      dados: { estado: 'cancelado', provedor_status: 'canceled', provedor_status_detail: null },
    });
    // Cancelou la, marcou aqui, e so entao a nova tentativa nasceu.
    const ordem = vi.mocked(cancelaOrdem).mock.invocationCallOrder[0];
    expect(ordem).toBeLessThan(vi.mocked(criaOrdem).mock.invocationCallOrder[0]);
    expect(criaOrdem).toHaveBeenCalledTimes(1);
  });

  it('procura as tentativas abertas do pedido que tem id no provedor', async () => {
    banco({ abertas: [PIX_ABERTO] });

    await pedirCartao();

    const busca = consultas.find(
      (c) => c.tabela === 'pagamentos' && c.ops.some((o) => o[0] === 'not')
    );
    expect(busca?.ops).toEqual(
      expect.arrayContaining([
        ['eq', 'order_id', PEDIDO],
        ['in', 'estado', ['criado', 'pendente', 'aprovado']],
        ['not', 'provedor_pagamento_id', 'is', null],
      ])
    );
  });

  // Reusar a chave da criacao faria o provedor devolver a ordem criada com
  // cara de cancelada; e a nova tentativa tem a sua propria.
  it('a chave do cancelamento nao e a da criacao de nenhuma tentativa', async () => {
    banco({ abertas: [PIX_ABERTO] });

    await pedirCartao();

    const chave = vi.mocked(cancelaOrdem).mock.calls[0][1];
    expect(chave).not.toBe('chave-pix');
    expect(chave).not.toBe('chave-estavel-1');
  });

  it('se nao der para cancelar a anterior, nao abre outra', async () => {
    banco({ abertas: [PIX_ABERTO] });
    vi.mocked(cancelaOrdem).mockResolvedValue({ ok: false, motivo: 'indisponivel' });

    expect(await pedirCartao()).toEqual({ ok: false, motivo: 'pagamento-pendente' });
    expect(gravado).toEqual([]);
    expect(criaOrdem).not.toHaveBeenCalled();
  });

  // O provedor recusa cancelar quando a ordem ja e final la. Paga: nenhuma
  // ordem nova, e o pedido ja virou `pago` ao aplicar.
  it('provedor nao deixa cancelar porque a anterior ja foi paga: nenhuma ordem nova', async () => {
    banco({ abertas: [PIX_ABERTO] });
    vi.mocked(cancelaOrdem).mockResolvedValue({ ok: false, motivo: 'invalido' });
    vi.mocked(consultaOrdem).mockResolvedValue({
      estado: 'aprovado',
      status: 'processed',
      statusDetail: 'accredited',
    });

    const r = await pedirCartao();

    expect(r).toEqual({ ok: true, estado: 'aprovado' });
    expect(consultaOrdem).toHaveBeenCalledWith('ORD-PIX');
    expect(atualizado.find((a) => a.tabela === 'orders')?.dados).toEqual({ status: 'pago' });
    expect(criaOrdem).not.toHaveBeenCalled();
  });

  it('provedor nao deixa cancelar e a anterior ja expirou la: morreu, cabe a nova', async () => {
    banco({ abertas: [PIX_ABERTO] });
    vi.mocked(cancelaOrdem).mockResolvedValue({ ok: false, motivo: 'invalido' });
    vi.mocked(consultaOrdem).mockResolvedValue({
      estado: 'cancelado',
      status: 'expired',
      statusDetail: null,
    });

    const r = await pedirCartao();

    expect(r.ok).toBe(true);
    expect(atualizado[0]?.dados.estado).toBe('cancelado');
    expect(criaOrdem).toHaveBeenCalledTimes(1);
  });

  it('provedor nao deixa cancelar e nao se sabe o estado: espera', async () => {
    banco({ abertas: [PIX_ABERTO] });
    vi.mocked(cancelaOrdem).mockResolvedValue({ ok: false, motivo: 'invalido' });
    vi.mocked(consultaOrdem).mockResolvedValue(null);

    expect(await pedirCartao()).toEqual({ ok: false, motivo: 'pagamento-pendente' });
    expect(criaOrdem).not.toHaveBeenCalled();
  });

  // Uma cobranca viva vale mais que o teto de tentativas: e conferida antes.
  it('as abertas sao encerradas antes de contar tentativas', async () => {
    banco({ ultimaTentativa: 20, abertas: [PIX_ABERTO] });

    expect(await pedirCartao()).toEqual({ ok: false, motivo: 'tentativas-demais' });
    expect(cancelaOrdem).toHaveBeenCalledTimes(1);
  });
});

describe('autorizacao', () => {
  it('sem sessao nao cobra', async () => {
    vi.mocked(usuarioDaSessao).mockResolvedValue(null);

    expect(await pedirPix()).toEqual({ ok: false, motivo: 'sem-sessao' });
    expect(criaOrdem).not.toHaveBeenCalled();
  });

  // A consulta filtra por dono, entao pedido alheio nao volta — e "nao e seu"
  // e "nao existe" dao a mesma resposta, sem um `if` para errar.
  it('pedido de outra pessoa responde igual a pedido inexistente', async () => {
    banco({ pedido: null as never });

    expect(await pedirPix()).toEqual({ ok: false, motivo: 'pedido-nao-encontrado' });
    expect(criaOrdem).not.toHaveBeenCalled();
  });

  it.each(['pago', 'em_producao', 'enviado', 'entregue', 'cancelado'])(
    'pedido em %s nao e cobrado de novo',
    async (status) => {
      banco({ pedido: { id: PEDIDO, total_centavos: 12000, status } });

      expect(await pedirPix()).toEqual({ ok: false, motivo: 'pedido-ja-pago' });
      expect(criaOrdem).not.toHaveBeenCalled();
    }
  );
});

describe('entrada invalida', () => {
  it.each([
    ['sem pedido', { payment_method_id: 'pix' }],
    ['pedido que nao e uuid', { pedido: '1', payment_method_id: 'pix' }],
    ['metodo vazio', { pedido: PEDIDO, payment_method_id: '' }],
    ['metodo com caractere estranho', { pedido: PEDIDO, payment_method_id: '../etc' }],
    [
      'parcelas zero',
      { pedido: PEDIDO, payment_method_id: 'master', token: 'abcd1234', installments: 0 },
    ],
    [
      'parcelas absurdas',
      { pedido: PEDIDO, payment_method_id: 'master', token: 'abcd1234', installments: 99 },
    ],
    [
      'CPF com letra',
      {
        pedido: PEDIDO,
        payment_method_id: 'pix',
        payer: { identification: { type: 'CPF', number: 'abc' } },
      },
    ],
    ['nao e objeto', 'pagar'],
    ['nulo', null],
  ])('recusa %s', async (_caso, corpo) => {
    expect(await cobra(corpo)).toEqual({ ok: false, motivo: 'entrada-invalida' });
    expect(criaOrdem).not.toHaveBeenCalled();
  });

  it('cartao sem token nao vai ao provedor', async () => {
    const r = await cobra({ pedido: PEDIDO, payment_method_id: 'master', installments: 1 });

    expect(r).toEqual({ ok: false, motivo: 'entrada-invalida' });
    expect(criaOrdem).not.toHaveBeenCalled();
  });
});

describe('cartao', () => {
  const pedirCartao = () =>
    cobra({
      pedido: PEDIDO,
      payment_method_id: 'master',
      token: 'tok12345678',
      installments: 3,
      payer: { identification: { type: 'CPF', number: '12345678909' } },
    });

  it('leva bandeira, token e parcelas', async () => {
    await pedirCartao();

    expect(vi.mocked(criaOrdem).mock.calls[0][0].metodo).toEqual({
      tipo: 'cartao',
      bandeira: 'master',
      token: 'tok12345678',
      parcelas: 3,
    });
  });

  it('leva o documento do pagador', async () => {
    await pedirCartao();

    expect(vi.mocked(criaOrdem).mock.calls[0][0].documento).toEqual({
      tipo: 'CPF',
      numero: '12345678909',
    });
  });

  // O ponto da #100: recusa nao cancela o pedido, e cabe outra tentativa.
  it('recusado nao mexe no status do pedido', async () => {
    vi.mocked(criaOrdem).mockResolvedValue({ ok: false, motivo: 'invalido' });

    const r = await pedirCartao();

    expect(r).toEqual({ ok: false, motivo: 'recusado' });
    expect(atualizado.some((a) => a.tabela === 'orders')).toBe(false);
  });

  it('recusado marca a tentativa como recusada', async () => {
    vi.mocked(criaOrdem).mockResolvedValue({ ok: false, motivo: 'invalido' });
    await pedirCartao();

    expect(atualizado.find((a) => a.tabela === 'pagamentos')?.dados.estado).toBe('recusado');
  });

  // 402: o provedor disse POR QUE o cartao foi recusado, e isso fica na
  // linha — e o que o dono le quando alguem pergunta "por que nao passou".
  it('402 grava o status_detail do cartao na tentativa', async () => {
    vi.mocked(criaOrdem).mockResolvedValue({
      ok: false,
      motivo: 'recusado',
      resumo: {
        estado: 'recusado',
        status: 'failed',
        statusDetail: 'cc_rejected_insufficient_amount',
      },
    });

    const r = await pedirCartao();

    expect(r).toEqual({ ok: false, motivo: 'recusado' });
    expect(atualizado.find((a) => a.tabela === 'pagamentos')?.dados).toEqual({
      estado: 'recusado',
      provedor_status: 'failed',
      provedor_status_detail: 'cc_rejected_insufficient_amount',
    });
  });

  it('400 grava o code do erro no lugar do detalhe', async () => {
    vi.mocked(criaOrdem).mockResolvedValue({
      ok: false,
      motivo: 'invalido',
      resumo: { estado: 'recusado', status: null, statusDetail: 'invalid_payer_identification' },
    });

    await pedirCartao();

    expect(atualizado.find((a) => a.tabela === 'pagamentos')?.dados).toEqual({
      estado: 'recusado',
      provedor_status: null,
      provedor_status_detail: 'invalid_payer_identification',
    });
  });

  // Credencial recusada pelo provedor (#23): problema nosso, e a resposta diz
  // isso em vez de "recusado". A tentativa morre — 401 nao cria ordem
  // nenhuma la, e deixa-la `criado` faria a proxima cobranca procurar uma
  // orfa que nao existe e responder "estamos confirmando seu pagamento".
  it('configuracao responde configuracao, encerra a tentativa e nao mexe no pedido', async () => {
    vi.mocked(criaOrdem).mockResolvedValue({ ok: false, motivo: 'configuracao' });

    const r = await pedirCartao();

    expect(r).toEqual({ ok: false, motivo: 'configuracao' });
    expect(atualizado.find((a) => a.tabela === 'pagamentos')?.dados).toEqual({
      estado: 'recusado',
      provedor_status: null,
      provedor_status_detail: null,
    });
    expect(atualizado.some((a) => a.tabela === 'orders')).toBe(false);
  });

  /**
   * O cenario da #20: o provedor responde 2xx com `status: failed` — cartao
   * sem limite. Nao e aprovacao, e a pessoa nao pode ser mandada ao pedido
   * como se tivesse pago: para ela e recusa igual, e cabe outro cartao.
   */
  it.each([
    ['recusado', 'failed', 'cc_rejected_insufficient_amount'],
    ['cancelado', 'cancelled', 'by_collector'],
  ] as const)('2xx com estado %s e recusa para quem paga', async (estado, status, detail) => {
    vi.mocked(criaOrdem).mockResolvedValue({
      ok: true,
      provedorId: 'mp-4',
      resumo: { estado, status, statusDetail: detail },
    });

    const r = await pedirCartao();

    expect(r).toEqual({ ok: false, motivo: 'recusado' });
    // A linha guarda o que o provedor disse, com o id da ordem que ele criou.
    expect(atualizado.find((a) => a.tabela === 'pagamentos')?.dados).toEqual({
      provedor_pagamento_id: 'mp-4',
      estado,
      provedor_status: status,
      provedor_status_detail: detail,
    });
    expect(atualizado.some((a) => a.tabela === 'orders')).toBe(false);
    expect(captureMessage).not.toHaveBeenCalled();
  });

  // Rede caindo nao e recusa: a cobranca pode ter acontecido do outro lado.
  // Marcar recusado aqui daria permissao para uma segunda cobranca.
  it('provedor fora do ar deixa a tentativa como criada', async () => {
    vi.mocked(criaOrdem).mockResolvedValue({ ok: false, motivo: 'indisponivel' });

    const r = await pedirCartao();

    expect(r).toEqual({ ok: false, motivo: 'indisponivel' });
    expect(atualizado.find((a) => a.tabela === 'pagamentos')?.dados.estado).toBe('criado');
  });

  const aprovado = () =>
    vi.mocked(criaOrdem).mockResolvedValue({
      ok: true,
      provedorId: 'mp-2',
      resumo: { estado: 'aprovado', status: 'processed', statusDetail: 'accredited' },
    });

  it('aprovado move o pedido para pago', async () => {
    aprovado();

    await pedirCartao();

    expect(atualizado.find((a) => a.tabela === 'orders')?.dados).toEqual({ status: 'pago' });
  });

  // O pedido so anda se ainda espera (#11, #24). O filtro E a regra: o dono
  // cancelando no meio da cobranca nao e sobrescrito por `pago`.
  it('aprovado so move o pedido se ele ainda aguarda pagamento', async () => {
    aprovado();

    await pedirCartao();

    const update = consultas.find(
      (c) => c.tabela === 'orders' && c.ops.some((o) => o[0] === 'eq' && o[1] === 'status')
    );
    expect(update?.ops).toEqual(
      expect.arrayContaining([
        ['eq', 'id', PEDIDO],
        ['eq', 'status', 'aguardando_pagamento'],
      ])
    );
  });

  // Dinheiro capturado para um pedido que nao vai sair: a cobranca ainda
  // responde o que houve, e o dono e avisado — nao se descobre isso sozinho.
  it('aprovado com pedido cancelado no meio nao grava pago e avisa o dono', async () => {
    aprovado();
    banco({ pedidoPendente: false, statusDepois: 'cancelado' });

    const r = await pedirCartao();

    expect(r).toEqual({ ok: true, estado: 'aprovado' });
    expect(captureMessage).toHaveBeenCalledWith('pagamento aprovado em pedido nao pendente', {
      level: 'error',
      tags: { order_id: PEDIDO },
    });
  });

  // Webhook e resposta sincrona correm. O webhook chegando antes nao e
  // problema — e nao vira aviso.
  it('pedido que o webhook ja marcou pago nao avisa', async () => {
    aprovado();
    banco({ pedidoPendente: false, statusDepois: 'pago' });

    await pedirCartao();

    expect(captureMessage).not.toHaveBeenCalled();
  });

  it('pendente nao move o pedido', async () => {
    vi.mocked(criaOrdem).mockResolvedValue({
      ok: true,
      provedorId: 'mp-3',
      resumo: { estado: 'pendente', status: 'action_required', statusDetail: null },
    });

    await pedirCartao();

    expect(atualizado.some((a) => a.tabela === 'orders')).toBe(false);
  });
});

describe('pix', () => {
  it('devolve o copia-e-cola e o QR do provedor', async () => {
    const r = await pedirPix();

    expect(r).toEqual({
      ok: true,
      estado: 'pendente',
      pix: { copiaECola: '00020126...', qrBase64: 'iVBOR', expiraEm: null },
    });
  });

  it('guarda o status cru do provedor ao lado do nosso', async () => {
    await pedirPix();

    const p = atualizado.find((a) => a.tabela === 'pagamentos')?.dados;
    expect(p?.estado).toBe('pendente');
    expect(p?.provedor_status).toBe('action_required');
    expect(p?.provedor_status_detail).toBe('waiting_transfer');
  });

  it('nao devolve objeto cru do provedor para a tela', async () => {
    const r = await pedirPix();

    expect(Object.keys(r).sort()).toEqual(['estado', 'ok', 'pix']);
  });
});
