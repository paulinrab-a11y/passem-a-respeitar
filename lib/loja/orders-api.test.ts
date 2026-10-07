import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buscaOrdensPorReferencia,
  consultaOrdem,
  criaOrdem,
  localizaOrdem,
  valorParaApi,
} from './orders-api';

/**
 * O banco guarda centavos inteiros e a Orders API quer decimal em string. Esta
 * conversao e a unica ponte entre os dois, e errar nela e errar o valor da
 * cobranca — por isso ela vive num lugar so, e por isso tem teste.
 */
describe('valorParaApi', () => {
  it.each([
    [12000, '120.00'],
    [12990, '129.90'],
    [500, '5.00'],
    [1, '0.01'],
    [99, '0.99'],
    [10_000_000, '100000.00'],
  ])('%i centavos vira "%s"', (centavos, esperado) => {
    expect(valorParaApi(centavos)).toBe(esperado);
  });

  it('sempre tem duas casas, mesmo em valor redondo', () => {
    expect(valorParaApi(12000)).toMatch(/\.\d{2}$/);
  });

  // 3335 / 100 em binario nao e exatamente 33.35. Se a conversao um dia passar
  // por arredondamento proprio, e aqui que aparece.
  it('nao perde centavo em valor que nao fecha em binario', () => {
    expect(valorParaApi(3335)).toBe('33.35');
    expect(valorParaApi(1015)).toBe('10.15');
  });
});

let chamada: { url: string; init: RequestInit | undefined } | null = null;

function respondeCom(corpo: unknown, status = 201) {
  chamada = null;
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    chamada = { url, init };
    return Promise.resolve(
      new Response(JSON.stringify(corpo), {
        status,
        headers: { 'Content-Type': 'application/json' },
      })
    );
  });
}

/** Explode com mensagem legivel se nada foi chamado, em vez de TypeError. */
function oQueFoiEnviado() {
  if (!chamada) throw new Error('esperava uma chamada ao provedor, e nao houve');
  return chamada;
}

const cabecalho = (nome: string) =>
  ((oQueFoiEnviado().init?.headers ?? {}) as Record<string, string>)[nome];

describe('criaOrdem', () => {
  const DADOS = {
    pedidoId: 'ped-1',
    totalCentavos: 12990,
    email: 'quem@exemplo.test',
    documento: null,
    metodo: { tipo: 'pix' } as const,
    idempotencia: 'chave-1',
  };

  const corpoEnviado = () => JSON.parse(String(oQueFoiEnviado().init?.body));

  const PIX_OK = {
    id: 'ORD-1',
    transactions: {
      payments: [
        {
          status: 'action_required',
          status_detail: 'waiting_transfer',
          payment_method: { qr_code: '00020126...', qr_code_base64: 'iVBOR' },
        },
      ],
    },
  };

  beforeEach(() => {
    vi.stubEnv('MERCADOPAGO_ACCESS_TOKEN', 'token-de-teste');
    respondeCom(PIX_OK);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('manda o valor do banco, em texto com duas casas', async () => {
    await criaOrdem(DADOS);

    expect(corpoEnviado().total_amount).toBe('129.90');
    expect(corpoEnviado().transactions.payments[0].amount).toBe('129.90');
  });

  // A chave de conciliacao: e por ela que o webhook acha o pedido depois.
  it('manda o id do pedido como external_reference', async () => {
    await criaOrdem(DADOS);

    expect(corpoEnviado().external_reference).toBe('ped-1');
  });

  it('manda a chave de idempotencia no header', async () => {
    await criaOrdem(DADOS);

    expect(cabecalho('X-Idempotency-Key')).toBe('chave-1');
  });

  it('Pix vai como bank_transfer', async () => {
    await criaOrdem(DADOS);

    expect(corpoEnviado().transactions.payments[0].payment_method).toEqual({
      id: 'pix',
      type: 'bank_transfer',
    });
  });

  it('cartao leva token, bandeira e parcelas', async () => {
    await criaOrdem({
      ...DADOS,
      metodo: { tipo: 'cartao', bandeira: 'master', token: 'tok-1', parcelas: 3 },
    });

    expect(corpoEnviado().transactions.payments[0].payment_method).toEqual({
      id: 'master',
      type: 'credit_card',
      token: 'tok-1',
      installments: 3,
    });
  });

  it('documento entra so quando existe', async () => {
    await criaOrdem(DADOS);
    expect(corpoEnviado().payer.identification).toBeUndefined();

    await criaOrdem({ ...DADOS, documento: { tipo: 'CPF', numero: '12345678909' } });
    expect(corpoEnviado().payer.identification).toEqual({ type: 'CPF', number: '12345678909' });
  });

  it('devolve o Pix que o provedor mandou', async () => {
    const r = await criaOrdem(DADOS);

    expect(r).toEqual({
      ok: true,
      provedorId: 'ORD-1',
      resumo: { estado: 'pendente', status: 'action_required', statusDetail: 'waiting_transfer' },
      pix: { copiaECola: '00020126...', qrBase64: 'iVBOR', expiraEm: null },
    });
  });

  it('resposta sem QR nao inventa Pix', async () => {
    respondeCom({
      id: 'ORD-2',
      transactions: { payments: [{ status: 'processed', status_detail: 'accredited' }] },
    });

    const r = await criaOrdem(DADOS);

    expect(r.ok && r.pix).toBeUndefined();
    expect(r.ok && r.resumo.estado).toBe('aprovado');
  });

  // 4xx e pedido nosso malformado ou cartao recusado; 5xx e problema la. A
  // diferenca importa: a primeira nao adianta repetir, a segunda sim.
  it.each([
    [400, 'invalido'],
    [402, 'invalido'],
    [422, 'invalido'],
    [500, 'indisponivel'],
    [503, 'indisponivel'],
  ])('HTTP %i vira %s', async (status, motivo) => {
    respondeCom({ message: 'nao deu' }, status);

    expect(await criaOrdem(DADOS)).toEqual({ ok: false, motivo });
  });

  // Rede caindo nao e recusa: a cobranca pode ter acontecido do outro lado.
  it('rede fora vira indisponivel, nao recusado', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('sem rede')));

    expect(await criaOrdem(DADOS)).toEqual({ ok: false, motivo: 'indisponivel' });
  });

  it('corpo que nao e JSON nao explode', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('nao e json', { status: 201 })));

    const r = await criaOrdem(DADOS);
    expect(r.ok).toBe(true);
  });

  // Falha fechada com o nome da variavel: seguir com undefined viraria "401
  // Unauthorized" tres camadas adiante, sem ninguem ligar ao cadastro.
  it('sem o Access Token, falha dizendo qual variavel falta', async () => {
    vi.stubEnv('MERCADOPAGO_ACCESS_TOKEN', '');

    await expect(criaOrdem(DADOS)).rejects.toThrow(/MERCADOPAGO_ACCESS_TOKEN/);
  });

  it('nunca manda o token no corpo', async () => {
    await criaOrdem({
      ...DADOS,
      metodo: { tipo: 'cartao', bandeira: 'master', token: 'tok-1', parcelas: 1 },
    });

    expect(String(oQueFoiEnviado().init?.body)).not.toContain('token-de-teste');
    expect(cabecalho('Authorization')).toBe('Bearer token-de-teste');
  });
});

/** Uma ordem como o provedor a devolve na consulta e na busca. */
const ORDEM = {
  id: 'ORD-1',
  external_reference: 'ped-1',
  created_date: '2026-10-07T12:00:02.000Z',
  status: 'processed',
  status_detail: 'accredited',
  transactions: { payments: [{ status: 'processed', status_detail: 'accredited' }] },
};

const RESUMO_APROVADO = { estado: 'aprovado', status: 'processed', statusDetail: 'accredited' };

/**
 * A consulta inteira: id, referencia, data e estado. E o que o webhook usa
 * para descobrir de que pedido e uma ordem que nenhuma linha nossa conhece.
 */
describe('localizaOrdem', () => {
  beforeEach(() => {
    vi.stubEnv('MERCADOPAGO_ACCESS_TOKEN', 'token-de-teste');
    respondeCom(ORDEM, 200);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('consulta a ordem pelo id, autenticada e sem corpo', async () => {
    await localizaOrdem('ORD-1');

    expect(oQueFoiEnviado().url).toBe('https://api.mercadopago.com/v1/orders/ORD-1');
    expect(cabecalho('Authorization')).toBe('Bearer token-de-teste');
    expect(oQueFoiEnviado().init?.body).toBeUndefined();
  });

  it('devolve id, referencia, data e estado — e nada mais', async () => {
    expect(await localizaOrdem('ORD-1')).toEqual({
      ok: true,
      ordem: {
        provedorId: 'ORD-1',
        referencia: 'ped-1',
        criadaEmMs: Date.parse('2026-10-07T12:00:02.000Z'),
        resumo: RESUMO_APROVADO,
      },
    });
  });

  it('id com caractere especial vai codificado na URL', async () => {
    await localizaOrdem('a/b c');

    expect(oQueFoiEnviado().url).toBe('https://api.mercadopago.com/v1/orders/a%2Fb%20c');
  });

  it('sem data nem referencia, os campos ficam nulos', async () => {
    respondeCom({ id: 'ORD-2', status: 'created' }, 200);

    expect(await localizaOrdem('ORD-2')).toEqual({
      ok: true,
      ordem: {
        provedorId: 'ORD-2',
        referencia: null,
        criadaEmMs: null,
        resumo: { estado: 'pendente', status: 'created', statusDetail: null },
      },
    });
  });

  // 404 e resposta: "isso nao e ordem nossa". Rede e 5xx sao "nao sei", e a
  // diferenca e dinheiro — a primeira autoriza seguir, a segunda manda esperar.
  it('404 e ordem inexistente, nao falha', async () => {
    respondeCom({ message: 'not found' }, 404);

    expect(await localizaOrdem('ORD-X')).toEqual({ ok: true, ordem: null });
  });

  it.each([401, 500, 503])('HTTP %i e "nao sei"', async (status) => {
    respondeCom({ message: 'nao deu' }, status);

    expect(await localizaOrdem('ORD-1')).toEqual({ ok: false });
  });

  it('rede fora e "nao sei"', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('sem rede')));

    expect(await localizaOrdem('ORD-1')).toEqual({ ok: false });
  });

  it('corpo que nao e JSON e "nao sei"', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('nao e json', { status: 200 })));

    expect(await localizaOrdem('ORD-1')).toEqual({ ok: false });
  });
});

describe('consultaOrdem', () => {
  beforeEach(() => {
    vi.stubEnv('MERCADOPAGO_ACCESS_TOKEN', 'token-de-teste');
    respondeCom(ORDEM, 200);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('devolve so o resumo', async () => {
    expect(await consultaOrdem('ORD-1')).toEqual(RESUMO_APROVADO);
  });

  // Nao conseguir confirmar nao e o mesmo que confirmar.
  it.each([404, 500])('HTTP %i vira null', async (status) => {
    respondeCom({ message: 'nao deu' }, status);

    expect(await consultaOrdem('ORD-1')).toBeNull();
  });
});

/**
 * A busca pelo `external_reference`: como uma tentativa cuja resposta se
 * perdeu reencontra a ordem que o provedor criou mesmo assim (#5, #14).
 */
describe('buscaOrdensPorReferencia', () => {
  const JANELA = {
    desdeMs: Date.parse('2026-10-07T12:00:00.000Z'),
    ateMs: Date.parse('2026-10-07T12:05:00.000Z'),
  };

  beforeEach(() => {
    vi.stubEnv('MERCADOPAGO_ACCESS_TOKEN', 'token-de-teste');
    respondeCom({ data: [ORDEM], paging: { total: 1 } }, 200);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('pede por external_reference, com a janela em RFC 3339', async () => {
    await buscaOrdensPorReferencia('ped-1', JANELA);

    const url = new URL(oQueFoiEnviado().url);
    expect(`${url.origin}${url.pathname}`).toBe('https://api.mercadopago.com/v1/orders');
    expect(url.searchParams.get('external_reference')).toBe('ped-1');
    // `begin_date` e `end_date` sao obrigatorios na API.
    expect(url.searchParams.get('begin_date')).toBe('2026-10-07T12:00:00Z');
    expect(url.searchParams.get('end_date')).toBe('2026-10-07T12:05:00Z');
    expect(oQueFoiEnviado().init?.body).toBeUndefined();
    expect(cabecalho('Authorization')).toBe('Bearer token-de-teste');
  });

  it('devolve cada ordem da lista, enxuta', async () => {
    respondeCom(
      {
        data: [
          ORDEM,
          {
            ...ORDEM,
            id: 'ORD-2',
            created_date: '2026-10-07T12:03:00.000Z',
            transactions: { payments: [{ status: 'failed', status_detail: 'cc_rejected' }] },
          },
        ],
        paging: { total: 2 },
      },
      200
    );

    expect(await buscaOrdensPorReferencia('ped-1', JANELA)).toEqual({
      ok: true,
      ordens: [
        {
          provedorId: 'ORD-1',
          referencia: 'ped-1',
          criadaEmMs: Date.parse('2026-10-07T12:00:02.000Z'),
          resumo: RESUMO_APROVADO,
        },
        {
          provedorId: 'ORD-2',
          referencia: 'ped-1',
          criadaEmMs: Date.parse('2026-10-07T12:03:00.000Z'),
          resumo: { estado: 'recusado', status: 'failed', statusDetail: 'cc_rejected' },
        },
      ],
    });
  });

  it('lista vazia e resposta, nao falha', async () => {
    respondeCom({ data: [], paging: { total: 0 } }, 200);

    expect(await buscaOrdensPorReferencia('ped-1', JANELA)).toEqual({ ok: true, ordens: [] });
  });

  it('ordem sem id na lista e ignorada', async () => {
    respondeCom({ data: [{ status: 'processed' }] }, 200);

    expect(await buscaOrdensPorReferencia('ped-1', JANELA)).toEqual({ ok: true, ordens: [] });
  });

  // Uma lista vazia aqui autoriza cobrar de novo. Forma que nao reconhecemos
  // nao pode virar lista vazia.
  it.each([{}, { results: [] }, { data: null }, 'texto'])(
    'forma desconhecida %j e "nao sei", nunca lista vazia',
    async (corpo) => {
      respondeCom(corpo, 200);

      expect(await buscaOrdensPorReferencia('ped-1', JANELA)).toEqual({ ok: false });
    }
  );

  it.each([400, 401, 500])('HTTP %i e "nao sei"', async (status) => {
    respondeCom({ message: 'nao deu' }, status);

    expect(await buscaOrdensPorReferencia('ped-1', JANELA)).toEqual({ ok: false });
  });

  it('rede fora e "nao sei"', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('sem rede')));

    expect(await buscaOrdensPorReferencia('ped-1', JANELA)).toEqual({ ok: false });
  });
});
