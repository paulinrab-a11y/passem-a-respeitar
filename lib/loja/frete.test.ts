import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Frete pelo Melhor Envio (#199). O Melhor Envio e um `fetch` dublado; o que
 * se prova aqui e o que NOS fazemos com a resposta dele:
 *
 *   - o pedido que sai daqui tem o token, a origem, o destino e as medidas
 *   - so PAC e SEDEX, so com preco e prazo que fazem sentido
 *   - qualquer falha e "sem cotacao", nunca frete zero
 *   - a mesma pergunta tem a mesma resposta por meia hora
 *   - em producao, so o Melhor Envio de producao
 */

const captureMessage = vi.fn();
const flush = vi.fn(async () => true);
vi.mock('@sentry/nextjs', () => ({
  captureMessage: (...a: unknown[]) => captureMessage(...a),
  flush: () => flush(),
}));
// O envio ao Sentry sai depois da resposta (#281); aqui so se confere o pedido.
const enviaDepois = vi.fn();
vi.mock('@/lib/sentry/depois', () => ({ enviaDepois: () => enviaDepois() }));

const { cotaFrete, paraCentavos } = await import('./frete');
type Volume = Parameters<typeof cotaFrete>[0]['volumes'][number];

// Inventado. O de verdade nunca entra num teste.
const TOKEN = 'token-de-teste';
const ORIGEM = '01310100';

const pedido = vi.fn<typeof fetch>();

const CAMISETA: Volume = {
  slug: 'camiseta-cbac',
  quantidade: 1,
  precoUnitarioCentavos: 12000,
  pesoGramas: 300,
  alturaCm: 4,
  larguraCm: 25,
  comprimentoCm: 30,
};

/** O que o Melhor Envio devolve para PAC e SEDEX, e um servico que nao interessa. */
const RESPOSTA = [
  {
    id: 1,
    name: 'PAC',
    price: '23.50',
    custom_price: '23.50',
    delivery_time: 8,
    custom_delivery_time: 8,
  },
  {
    id: 2,
    name: 'SEDEX',
    price: '45.90',
    custom_price: '45.90',
    delivery_time: 3,
    custom_delivery_time: 3,
  },
  { id: 3, name: '.Package', price: '19.00', delivery_time: 6 },
];

let cep = 20000000;
/** CEP novo a cada chamada: o cache guarda resposta por CEP. */
const novoCep = () => String(cep++);

function responde(corpo: unknown, status = 200) {
  pedido.mockImplementation(async () => new Response(JSON.stringify(corpo), { status }));
}

function enviado() {
  const [url, opcoes] = pedido.mock.calls[0];
  return {
    url: String(url),
    metodo: opcoes?.method,
    cabecalhos: opcoes?.headers as Record<string, string>,
    corpo: JSON.parse(String(opcoes?.body)),
  };
}

const avisos = () => captureMessage.mock.calls.map(([, o]) => o.tags.motivo);

const cota = (volumes: Volume[] = [CAMISETA], destino = novoCep()) =>
  cotaFrete({ cep: destino, volumes });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', pedido);
  vi.stubEnv('MELHOR_ENVIO_TOKEN', TOKEN);
  vi.stubEnv('MELHOR_ENVIO_CEP_ORIGEM', ORIGEM);
  vi.stubEnv('MELHOR_ENVIO_AMBIENTE', '');
  vi.stubEnv('MELHOR_ENVIO_URL', '');
  vi.stubEnv('VERCEL_ENV', '');
  vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
  vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
  responde(RESPOSTA);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('o pedido ao Melhor Envio', () => {
  it('sai com o token, a origem, o destino e as medidas', async () => {
    await cota([CAMISETA], '04538133');

    const { url, metodo, cabecalhos, corpo } = enviado();
    expect(url).toBe('https://sandbox.melhorenvio.com.br/api/v2/me/shipment/calculate');
    expect(metodo).toBe('POST');
    expect(cabecalhos.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(cabecalhos.Accept).toBe('application/json');
    expect(cabecalhos['Content-Type']).toBe('application/json');
    // Eles pedem nome da aplicacao e um e-mail de contato.
    expect(cabecalhos['User-Agent']).toMatch(/^Passem a Respeitar \(.+@.+\)$/);
    expect(corpo).toEqual({
      from: { postal_code: ORIGEM },
      to: { postal_code: '04538133' },
      products: [
        {
          id: 'camiseta-cbac',
          width: 25,
          height: 4,
          length: 30,
          weight: 0.3,
          insurance_value: 120,
          quantity: 1,
        },
      ],
      options: { receipt: false, own_hand: false },
      services: '1,2',
    });
  });

  it('o valor declarado e o preco da peca, para o seguro cobrir o que ela vale', async () => {
    await cota([{ ...CAMISETA, quantidade: 3, precoUnitarioCentavos: 13050 }]);

    const [produto] = enviado().corpo.products;
    expect(produto.insurance_value).toBe(130.5);
    expect(produto.quantity).toBe(3);
  });

  it('o CEP de origem pode estar com hifen no ambiente', async () => {
    vi.stubEnv('MELHOR_ENVIO_CEP_ORIGEM', '01310-100');
    await cota();

    expect(enviado().corpo.from).toEqual({ postal_code: '01310100' });
  });

  it('em producao, vai ao Melhor Envio de producao', async () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('MELHOR_ENVIO_AMBIENTE', 'producao');
    await cota();

    expect(enviado().url).toBe('https://melhorenvio.com.br/api/v2/me/shipment/calculate');
  });

  it('o desvio da suite vale fora de producao', async () => {
    vi.stubEnv('MELHOR_ENVIO_URL', 'http://localhost:46330');
    await cota();

    expect(enviado().url).toBe('http://localhost:46330/api/v2/me/shipment/calculate');
  });

  it('e e ignorado em producao: ninguem aponta o frete para outro lugar por variavel', async () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('MELHOR_ENVIO_AMBIENTE', 'producao');
    vi.stubEnv('MELHOR_ENVIO_URL', 'https://outro-lugar.invalid');
    await cota();

    expect(enviado().url).toBe('https://melhorenvio.com.br/api/v2/me/shipment/calculate');
  });

  it('tem prazo: nao segura o checkout esperando o Melhor Envio', async () => {
    await cota();
    expect(pedido.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });
});

describe('a resposta', () => {
  it('vira PAC e SEDEX em centavos, e o resto fica de fora', async () => {
    expect(await cota()).toEqual({
      ok: true,
      opcoes: [
        { servico: 'pac', nome: 'PAC', precoCentavos: 2350, prazoDias: 8 },
        { servico: 'sedex', nome: 'SEDEX', precoCentavos: 4590, prazoDias: 3 },
      ],
    });
  });

  it('vale o preco e o prazo da conta, quando ela tem desconto', async () => {
    responde([
      { id: 1, price: '30.00', custom_price: '21.10', delivery_time: 9, custom_delivery_time: 7 },
    ]);

    expect(await cota()).toEqual({
      ok: true,
      opcoes: [{ servico: 'pac', nome: 'PAC', precoCentavos: 2110, prazoDias: 7 }],
    });
  });

  it('sem os valores da conta, vale a tabela', async () => {
    responde([{ id: 2, price: 45.9, delivery_time: 3 }]);

    expect(await cota()).toEqual({
      ok: true,
      opcoes: [{ servico: 'sedex', nome: 'SEDEX', precoCentavos: 4590, prazoDias: 3 }],
    });
  });

  it('servico que nao atende o CEP vem com erro, e sai da lista', async () => {
    responde([
      { id: 1, price: '23.50', delivery_time: 8 },
      { id: 2, error: 'Serviço indisponível para o trecho.' },
    ]);

    const r = await cota();
    expect(r.ok && r.opcoes.map((o) => o.servico)).toEqual(['pac']);
  });

  it('nenhum dos dois atende: sem servico', async () => {
    responde([
      { id: 1, error: 'Serviço indisponível para o trecho.' },
      { id: 2, error: 'Serviço indisponível para o trecho.' },
    ]);

    expect(await cota()).toEqual({ ok: false, motivo: 'frete-sem-servico' });
  });

  it.each([
    ['preco zero', { id: 1, price: '0.00', delivery_time: 8 }],
    ['preco negativo', { id: 1, price: '-5.00', delivery_time: 8 }],
    ['preco com tres casas', { id: 1, price: '23.505', delivery_time: 8 }],
    ['preco em texto solto', { id: 1, price: 'R$ 23,50', delivery_time: 8 }],
    ['sem preco', { id: 1, delivery_time: 8 }],
    ['sem prazo', { id: 1, price: '23.50' }],
    ['prazo zero', { id: 1, price: '23.50', delivery_time: 0 }],
    ['prazo quebrado', { id: 1, price: '23.50', delivery_time: 2.5 }],
    ['prazo absurdo', { id: 1, price: '23.50', delivery_time: 400 }],
  ])('%s: a opcao nao entra', async (_, linha) => {
    responde([linha]);

    expect(await cota()).toEqual({ ok: false, motivo: 'frete-sem-servico' });
  });

  it.each([
    ['objeto no lugar de lista', { data: RESPOSTA }],
    ['lista de texto', ['PAC']],
    ['id em texto', [{ id: '1', price: '23.50', delivery_time: 8 }]],
  ])('%s: resposta torta, sem cotacao', async (_, corpo) => {
    responde(corpo);

    expect(await cota()).toEqual({ ok: false, motivo: 'frete-fora-do-ar' });
    expect(avisos()).toEqual(['resposta-torta']);
  });

  it('resposta que nem e JSON: sem cotacao', async () => {
    pedido.mockImplementation(async () => new Response('<html>502</html>', { status: 200 }));

    expect(await cota()).toEqual({ ok: false, motivo: 'frete-fora-do-ar' });
  });
});

describe('falhas', () => {
  it('rede fora: sem cotacao, e avisa', async () => {
    pedido.mockRejectedValue(new Error('ECONNRESET'));

    expect(await cota()).toEqual({ ok: false, motivo: 'frete-fora-do-ar' });
    expect(avisos()).toEqual(['fora-do-ar']);
  });

  it.each([401, 403])('HTTP %i e token vencido ou sem permissao: avisa', async (status) => {
    responde({ message: 'Unauthenticated.' }, status);

    expect(await cota()).toEqual({ ok: false, motivo: 'frete-sem-configuracao' });
    expect(avisos()).toEqual([`http-${status}`]);
  });

  it('HTTP 422 e CEP que nao existe: nao avisa, e a pessoa que confere', async () => {
    responde({ message: 'The given data was invalid.' }, 422);

    expect(await cota()).toEqual({ ok: false, motivo: 'frete-cep-invalido' });
    expect(captureMessage).not.toHaveBeenCalled();
  });

  it.each([429, 500, 503])('HTTP %i: sem cotacao, e avisa', async (status) => {
    responde({}, status);

    expect(await cota()).toEqual({ ok: false, motivo: 'frete-fora-do-ar' });
    expect(avisos()).toEqual([`http-${status}`]);
  });

  // #281: quem digitou o CEP nao espera o aviso ao dono chegar no Sentry.
  it('o aviso sai depois da resposta, sem esperar o Sentry', async () => {
    responde({}, 503);

    expect(await cota()).toEqual({ ok: false, motivo: 'frete-fora-do-ar' });
    expect(enviaDepois).toHaveBeenCalledTimes(1);
    expect(flush).not.toHaveBeenCalled();
  });

  it('nada que vai ao Sentry leva token, CEP ou corpo', async () => {
    pedido.mockRejectedValue(new Error(`falhou com ${TOKEN}`));
    await cota([CAMISETA], '04538133');

    const texto = JSON.stringify(captureMessage.mock.calls);
    expect(texto).not.toContain(TOKEN);
    expect(texto).not.toContain('04538133');
    expect(texto).not.toContain(ORIGEM);
  });
});

describe('antes de perguntar', () => {
  it.each(['0131010', '013101000', 'abcdefgh', ''])(
    'CEP %j recusa sem consultar',
    async (destino) => {
      expect(await cotaFrete({ cep: destino, volumes: [CAMISETA] })).toEqual({
        ok: false,
        motivo: 'frete-cep-invalido',
      });
      expect(pedido).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['sem token', 'MELHOR_ENVIO_TOKEN', ''],
    ['sem origem', 'MELHOR_ENVIO_CEP_ORIGEM', ''],
    ['origem pela metade', 'MELHOR_ENVIO_CEP_ORIGEM', '0131'],
  ])('%s: sem configuracao, sem consultar', async (_, nome, valor) => {
    vi.stubEnv(nome, valor);

    expect(await cota()).toEqual({ ok: false, motivo: 'frete-sem-configuracao' });
    expect(pedido).not.toHaveBeenCalled();
  });

  it('em producao, configuracao faltando avisa', async () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('MELHOR_ENVIO_AMBIENTE', 'producao');
    vi.stubEnv('MELHOR_ENVIO_TOKEN', '');

    await cota();
    expect(avisos()).toEqual(['sem-configuracao']);
  });

  // O mesmo raciocinio das chaves de teste da Cloudflare (#28): preco de
  // sandbox em producao e preco inventado com cara de verdade.
  it('em producao, o Melhor Envio de sandbox nao vale', async () => {
    vi.stubEnv('VERCEL_ENV', 'production');

    expect(await cota()).toEqual({ ok: false, motivo: 'frete-sem-configuracao' });
    expect(pedido).not.toHaveBeenCalled();
  });

  it.each([
    ['sem peso', { pesoGramas: null }],
    ['sem altura', { alturaCm: null }],
    ['sem largura', { larguraCm: null }],
    ['sem comprimento', { comprimentoCm: null }],
    ['peso zero', { pesoGramas: 0 }],
  ])('produto %s: sem medida, sem consultar', async (_, falta) => {
    expect(await cota([{ ...CAMISETA, ...falta }])).toEqual({
      ok: false,
      motivo: 'frete-sem-medida',
    });
    expect(pedido).not.toHaveBeenCalled();
  });

  it('carrinho vazio: sem medida, sem consultar', async () => {
    expect(await cota([])).toEqual({ ok: false, motivo: 'frete-sem-medida' });
    expect(pedido).not.toHaveBeenCalled();
  });

  it('basta um produto sem medida para nao haver frete', async () => {
    const outro = { ...CAMISETA, slug: 'poster', pesoGramas: null };
    expect(await cota([CAMISETA, outro])).toEqual({ ok: false, motivo: 'frete-sem-medida' });
  });
});

describe('cache', () => {
  it('a mesma pergunta, de novo, tem a mesma resposta sem nova consulta', async () => {
    const destino = novoCep();
    const primeira = await cota([CAMISETA], destino);

    responde([{ id: 1, price: '99.00', delivery_time: 1 }]);
    const segunda = await cota([CAMISETA], destino);

    expect(segunda).toEqual(primeira);
    expect(pedido).toHaveBeenCalledTimes(1);
  });

  it('CEP diferente e pergunta diferente', async () => {
    await cota();
    await cota();
    expect(pedido).toHaveBeenCalledTimes(2);
  });

  it('carrinho diferente e pergunta diferente', async () => {
    const destino = novoCep();
    await cota([CAMISETA], destino);
    await cota([{ ...CAMISETA, quantidade: 2 }], destino);
    expect(pedido).toHaveBeenCalledTimes(2);
  });

  it('falha nao fica guardada: a proxima tentativa pergunta de novo', async () => {
    const destino = novoCep();
    pedido.mockRejectedValueOnce(new Error('ECONNRESET'));

    expect((await cota([CAMISETA], destino)).ok).toBe(false);
    expect((await cota([CAMISETA], destino)).ok).toBe(true);
    expect(pedido).toHaveBeenCalledTimes(2);
  });

  it('trocar de ambiente nao devolve preco do ambiente anterior', async () => {
    const destino = novoCep();
    await cota([CAMISETA], destino);

    vi.stubEnv('MELHOR_ENVIO_URL', 'http://localhost:46330');
    await cota([CAMISETA], destino);

    expect(pedido).toHaveBeenCalledTimes(2);
  });
});

describe('paraCentavos', () => {
  it.each([
    ['23.50', 2350],
    ['23.5', 2350],
    ['23', 2300],
    ['0.10', 10],
    [' 7.05 ', 705],
    [45.9, 4590],
    [0.1 + 0.2, 30],
  ])('%j vira %i', (bruto, centavos) => {
    expect(paraCentavos(bruto)).toBe(centavos);
  });

  it.each(['23,50', '23.505', '-1', '1e3', '', 'abc', '1234567.00'])('%j fica de fora', (bruto) => {
    expect(paraCentavos(bruto)).toBeNull();
  });
});
