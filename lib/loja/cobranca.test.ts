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
 * a DECISAO da cobranca diante do que eles respondem.
 */
vi.mock('@/lib/supabase/servidor', () => ({ usuarioDaSessao: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ clienteAdmin: vi.fn() }));
vi.mock('./orders-api', () => ({ criaOrdem: vi.fn() }));
vi.mock('./webhook', () => ({ casaOrfa: vi.fn(), orfaDoPedido: vi.fn() }));

const { usuarioDaSessao } = await import('@/lib/supabase/servidor');
const { clienteAdmin } = await import('@/lib/supabase/admin');
const { criaOrdem } = await import('./orders-api');
const { casaOrfa, orfaDoPedido } = await import('./webhook');
const { cobra } = await import('./cobranca');

const USUARIO = { id: 'uuu-1', email: 'quem@exemplo.test' };
const PEDIDO = '11111111-2222-4333-8444-555555555555';

/** O que cada tabela recebeu, para conferir o que foi gravado. */
let gravado: { tabela: string; dados: Record<string, unknown> }[] = [];
let atualizado: { tabela: string; dados: Record<string, unknown> }[] = [];

function banco({
  pedido = { id: PEDIDO, total_centavos: 12000, status: 'aguardando_pagamento' },
  ultimaTentativa = null as number | null,
  falhaAoInserir = false,
}) {
  vi.mocked(clienteAdmin).mockReturnValue({
    from(tabela: string) {
      const elo: Record<string, unknown> = {};
      elo.select = () => elo;
      elo.eq = () => elo;
      elo.order = () => elo;
      elo.limit = () =>
        Promise.resolve({
          data: ultimaTentativa === null ? [] : [{ tentativa: ultimaTentativa }],
          error: null,
        });
      elo.maybeSingle = () => Promise.resolve({ data: pedido, error: null });
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
        return elo;
      };
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
  vi.mocked(usuarioDaSessao).mockResolvedValue(USUARIO as never);
  vi.mocked(criaOrdem).mockResolvedValue(pixOk);
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

  it('orfa ainda pendente la: e ela que vale, nao se abre outra', async () => {
    vi.mocked(orfaDoPedido).mockResolvedValue(orfaCom(RECENTE));
    vi.mocked(casaOrfa).mockResolvedValue({ tipo: 'aplicado', estado: 'pendente' });

    expect(await pedirPix()).toEqual({ ok: true, estado: 'pendente' });
    expect(gravado).toEqual([]);
    expect(criaOrdem).not.toHaveBeenCalled();
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

  // Rede caindo nao e recusa: a cobranca pode ter acontecido do outro lado.
  // Marcar recusado aqui daria permissao para uma segunda cobranca.
  it('provedor fora do ar deixa a tentativa como criada', async () => {
    vi.mocked(criaOrdem).mockResolvedValue({ ok: false, motivo: 'indisponivel' });

    const r = await pedirCartao();

    expect(r).toEqual({ ok: false, motivo: 'indisponivel' });
    expect(atualizado.find((a) => a.tabela === 'pagamentos')?.dados.estado).toBe('criado');
  });

  it('aprovado move o pedido para pago', async () => {
    vi.mocked(criaOrdem).mockResolvedValue({
      ok: true,
      provedorId: 'mp-2',
      resumo: { estado: 'aprovado', status: 'processed', statusDetail: 'accredited' },
    });

    await pedirCartao();

    expect(atualizado.find((a) => a.tabela === 'orders')?.dados).toEqual({ status: 'pago' });
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
