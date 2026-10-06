import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A acao e fina de proposito — quem decide dinheiro e a `criaPedido`, que tem
 * os proprios testes. O que se prova aqui e o que a PESSOA ve: qual mensagem,
 * qual campo recebe foco, e que o sucesso leva para o pedido.
 */
vi.mock('@/lib/supabase/servidor', () => ({ usuarioDaSessao: vi.fn() }));
vi.mock('@/lib/loja/pedido', () => ({ criaPedido: vi.fn() }));
vi.mock('@/lib/loja/catalogo', () => ({ opcoesDeFrete: vi.fn() }));
vi.mock('@/lib/loja/endereco-por-cep', () => ({ buscaEnderecoPeloCep: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: vi.fn(() => {
    // O `redirect` do Next lanca para interromper a execucao. O duble imita
    // isso; sem lancar, o teste nao distingue "redirecionou" de "seguiu".
    throw new Error('NEXT_REDIRECT');
  }),
}));

const { usuarioDaSessao } = await import('@/lib/supabase/servidor');
const { criaPedido } = await import('@/lib/loja/pedido');
const { opcoesDeFrete } = await import('@/lib/loja/catalogo');
const { buscaEnderecoPeloCep } = await import('@/lib/loja/endereco-por-cep');
const { redirect } = await import('next/navigation');
const { buscarEndereco, cotarFrete, finalizarCompra } = await import('./acoes');
const { checkoutInicial } = await import('./estado');

const ENDERECO = {
  nome: 'Fulano de Teste',
  cep: '01310-100',
  logradouro: 'Avenida Paulista',
  numero: '1578',
  complemento: 'apto 92',
  bairro: 'Bela Vista',
  cidade: 'São Paulo',
  uf: 'SP',
};

function formulario(extra: Record<string, string> = {}) {
  const f = new FormData();
  f.set('slug', 'camiseta-cbac');
  f.set('tamanho', 'M');
  f.set('quantidade', '1');
  f.set('servico', 'pac');
  for (const [k, v] of Object.entries(ENDERECO)) f.set(k, v);
  for (const [k, v] of Object.entries(extra)) f.set(k, v);
  return f;
}

const enviar = (extra?: Record<string, string>) =>
  finalizarCompra(checkoutInicial, formulario(extra));

beforeEach(() => {
  vi.clearAllMocks();
  // Usuario diferente a cada teste: o rate limit e por usuario e guarda estado
  // entre chamadas.
  vi.mocked(usuarioDaSessao).mockResolvedValue({
    id: `usuario-${Math.random()}`,
    email: 'quem@exemplo.test',
    email_confirmed_at: '2026-09-01T00:00:00Z',
  } as never);
  vi.mocked(criaPedido).mockResolvedValue({
    ok: true,
    id: 'ped-1',
    numero: 7,
    totalCentavos: 12000,
  });
});

describe('sucesso', () => {
  // A costura que a #113 encontrou solta: o pedido nasce aguardando pagamento,
  // e a tela de pagar nao tinha nenhum caminho ate ela.
  it('leva para o PAGAMENTO do pedido criado, nao para o detalhe', async () => {
    const r = await enviar();

    expect(r.irPara).toBe('/checkout/pagamento/ped-1');
    expect(r.recado).toBeNull();
  });

  // `redirect()` em server action e navegacao suave, e a tela de pagamento
  // chegaria sem a propria CSP. Quem navega e o cliente, com carregamento
  // completo. Se alguem voltar ao `redirect()`, este teste cai. (#118)
  it('nao usa redirect(): o cliente faz a navegacao completa', async () => {
    await enviar();

    expect(redirect).not.toHaveBeenCalled();
  });

  it('manda para a criacao so escolha, nunca valor', async () => {
    expect((await enviar()).irPara).toBeTruthy();

    const [entrada] = vi.mocked(criaPedido).mock.calls[0];
    expect(entrada).toEqual({
      itens: [{ slug: 'camiseta-cbac', tamanho: 'M', quantidade: 1 }],
      endereco: { ...ENDERECO, cep: '01310100' },
      servico: 'pac',
    });
  });

  // Campo oculto adulterado no DevTools muda O QUE se compra, nunca quanto
  // custa — o preco e recalculado dentro da criaPedido.
  it('quantidade do campo oculto vale como escolha', async () => {
    expect((await enviar({ quantidade: '3' })).irPara).toBeTruthy();

    expect(vi.mocked(criaPedido).mock.calls[0][0]).toMatchObject({
      itens: [{ quantidade: 3 }],
    });
  });

  it('campo de dinheiro injetado no formulario nem chega na criacao', async () => {
    expect(
      (await enviar({ total: '1', preco: '1', desconto: '11900', user_id: 'outro' })).irPara
    ).toBeTruthy();

    expect(JSON.stringify(vi.mocked(criaPedido).mock.calls[0][0])).not.toMatch(
      /total|preco|desconto|user_id/
    );
  });
});

describe('erro de entrega', () => {
  it('aponta o campo que errou, para a tela focar nele', async () => {
    const r = await enviar({ uf: 'XX' });

    expect(r.campo).toBe('uf');
    expect(r.recado?.tom).toBe('erro');
    expect(criaPedido).not.toHaveBeenCalled();
  });

  it.each([
    ['cep', { cep: '123' }],
    ['nome', { nome: '' }],
    ['numero', { numero: '' }],
    ['cidade', { cidade: '' }],
  ])('aponta %s', async (esperado, campo) => {
    expect((await enviar(campo)).campo).toBe(esperado);
  });

  it('complemento vazio nao e erro', async () => {
    expect((await enviar({ complemento: '' })).irPara).toBeTruthy();
  });
});

describe('recusa', () => {
  // O "acesso limitado" da conta nao verificada (#30).
  it('e-mail nao verificado nao cria pedido', async () => {
    vi.mocked(usuarioDaSessao).mockResolvedValue({
      id: 'nao-verificado',
      email: 'x@exemplo.test',
      email_confirmed_at: null,
    } as never);

    const r = await enviar();

    expect(r.recado?.texto).toMatch(/confirme seu e-mail/i);
    expect(criaPedido).not.toHaveBeenCalled();
  });

  it('sem sessao', async () => {
    vi.mocked(usuarioDaSessao).mockResolvedValue(null);

    const r = await finalizarCompra(checkoutInicial, formulario());

    expect(r.recado?.texto).toMatch(/sess/i);
    expect(criaPedido).not.toHaveBeenCalled();
  });

  it('tamanho que nao existe nem chega a criar', async () => {
    const r = await enviar({ tamanho: 'XXG' });

    expect(r.recado?.tom).toBe('erro');
    expect(criaPedido).not.toHaveBeenCalled();
  });

  // Nenhuma mensagem conta o que o catalogo tem ou deixa de ter.
  it.each([
    ['produto-indisponivel', /não está disponível/i],
    ['catalogo-indisponivel', /catálogo/i],
    ['nao-consegui-gravar', /não consegui criar/i],
  ])('traduz %s para a pessoa', async (motivo, padrao) => {
    vi.mocked(criaPedido).mockResolvedValue({ ok: false, motivo } as never);

    expect((await enviar()).recado?.texto).toMatch(padrao);
  });

  it('motivo desconhecido nao vaza para a tela', async () => {
    vi.mocked(criaPedido).mockResolvedValue({ ok: false, motivo: 'coisa-nova' } as never);

    const r = await enviar();

    expect(r.recado?.texto).not.toMatch(/coisa-nova/);
    expect(r.recado?.texto).toMatch(/não consegui criar/i);
  });

  it('para depois de dez tentativas na mesma hora', async () => {
    vi.mocked(usuarioDaSessao).mockResolvedValue({
      id: 'sempre-o-mesmo',
      email_confirmed_at: '2026-09-01T00:00:00Z',
    } as never);
    vi.mocked(criaPedido).mockResolvedValue({ ok: false, motivo: 'nao-consegui-gravar' });

    for (let i = 0; i < 10; i++) await enviar();
    const onze = await enviar();

    expect(onze.recado?.texto).toMatch(/muitas tentativas/i);
  });
});

describe('escolha do frete (#199)', () => {
  it('SEDEX escolhido chega como escolha', async () => {
    await enviar({ servico: 'sedex' });

    expect(vi.mocked(criaPedido).mock.calls[0][0]).toMatchObject({ servico: 'sedex' });
  });

  it.each([
    ['sem escolha', ''],
    ['inventada', 'jato'],
    ['em maiuscula', 'SEDEX'],
  ])('%s: pede para escolher, foca no grupo e nao cria', async (_, servico) => {
    const r = await enviar({ servico });

    expect(r.recado?.texto).toBe('Escolha PAC ou SEDEX.');
    expect(r.campo).toBe('servico');
    expect(criaPedido).not.toHaveBeenCalled();
  });

  it('preco de frete no formulario nem chega na criacao', async () => {
    await enviar({ frete: '0', freteCentavos: '0', preco_frete: '1' });

    const [entrada] = vi.mocked(criaPedido).mock.calls[0];
    expect(Object.keys(entrada as object).sort()).toEqual(['endereco', 'itens', 'servico']);
  });

  it.each([
    ['frete-fora-do-ar', 'Não consegui calcular o frete agora. Tente de novo em instantes.'],
    ['frete-cep-invalido', 'Confira o CEP: não encontrei esse endereço.'],
    ['frete-sem-servico', 'Os Correios não entregam nesse CEP por PAC nem por SEDEX.'],
    ['frete-servico-indisponivel', 'Esse tipo de envio não atende esse CEP. Escolha o outro.'],
  ] as const)('traduz %s', async (motivo, texto) => {
    vi.mocked(criaPedido).mockResolvedValue({ ok: false, motivo });

    expect((await enviar()).recado?.texto).toBe(texto);
  });

  // Configuracao faltando e produto sem medida sao problema do site, e a
  // pessoa nao tem o que fazer com o nome deles.
  it.each(['frete-sem-configuracao', 'frete-sem-medida'] as const)(
    '%s nao conta o que falta',
    async (motivo) => {
      vi.mocked(criaPedido).mockResolvedValue({ ok: false, motivo });

      const texto = (await enviar()).recado?.texto ?? '';
      expect(texto).toBe('O frete está indisponível no momento. Tente de novo mais tarde.');
      expect(texto).not.toMatch(/token|medida|configura|melhor envio/i);
    }
  );
});

describe('cotarFrete (#199)', () => {
  const OPCOES = [
    { servico: 'pac', nome: 'PAC', precoCentavos: 2350, prazoDias: 8 },
    { servico: 'sedex', nome: 'SEDEX', precoCentavos: 4590, prazoDias: 3 },
  ] as const;

  const cotar = (extra: Record<string, unknown> = {}) =>
    cotarFrete({
      slug: 'camiseta-cbac',
      tamanho: 'M',
      quantidade: '1',
      cep: '01310-100',
      ...extra,
    });

  beforeEach(() => {
    vi.mocked(opcoesDeFrete).mockResolvedValue({
      ok: true,
      subtotalCentavos: 12000,
      opcoes: [...OPCOES],
    });
  });

  it('devolve PAC e SEDEX do catalogo, com o CEP so em digitos', async () => {
    expect(await cotar()).toEqual({ ok: true, subtotalCentavos: 12000, opcoes: OPCOES });
    expect(opcoesDeFrete).toHaveBeenCalledWith(
      [{ slug: 'camiseta-cbac', tamanho: 'M', quantidade: 1 }],
      '01310100'
    );
  });

  it('sem sessao nao cota', async () => {
    vi.mocked(usuarioDaSessao).mockResolvedValue(null);

    expect((await cotar()).ok).toBe(false);
    expect(opcoesDeFrete).not.toHaveBeenCalled();
  });

  it.each(['0131010', '013101000', 'abcdefgh', '', 13101000, null])(
    'CEP %j recusa sem consultar',
    async (cep) => {
      expect(await cotar({ cep })).toEqual({
        ok: false,
        texto: 'Confira o CEP: não encontrei esse endereço.',
      });
      expect(opcoesDeFrete).not.toHaveBeenCalled();
    }
  );

  it('item que nao passa no schema recusa sem consultar', async () => {
    expect((await cotar({ quantidade: '0' })).ok).toBe(false);
    expect(opcoesDeFrete).not.toHaveBeenCalled();
  });

  it('para depois de trinta consultas em dez minutos', async () => {
    for (let i = 0; i < 30; i++) expect((await cotar()).ok).toBe(true);

    const r = await cotar();
    expect(r).toEqual({
      ok: false,
      texto: 'Muitas consultas de frete. Tente de novo em alguns minutos.',
    });
    expect(opcoesDeFrete).toHaveBeenCalledTimes(30);
  });

  it('falha da cotacao vira frase para a pessoa', async () => {
    vi.mocked(opcoesDeFrete).mockResolvedValue({ ok: false, motivo: 'frete-fora-do-ar' });

    expect(await cotar()).toEqual({
      ok: false,
      texto: 'Não consegui calcular o frete agora. Tente de novo em instantes.',
    });
  });
});

describe('buscarEndereco (#204)', () => {
  const PAULISTA = {
    logradouro: 'Avenida Paulista',
    bairro: 'Bela Vista',
    cidade: 'São Paulo',
    uf: 'SP',
  };

  beforeEach(() => {
    vi.mocked(buscaEnderecoPeloCep).mockResolvedValue({ ok: true, endereco: PAULISTA });
  });

  it('devolve o endereco do CEP, so em digitos', async () => {
    expect(await buscarEndereco('01310-100')).toEqual(PAULISTA);
    expect(buscaEnderecoPeloCep).toHaveBeenCalledWith('01310100');
  });

  it('sem sessao nao consulta', async () => {
    vi.mocked(usuarioDaSessao).mockResolvedValue(null);
    expect(await buscarEndereco('01310100')).toBeNull();
    expect(buscaEnderecoPeloCep).not.toHaveBeenCalled();
  });

  it.each(['0131010', '', 1310100, null, { cep: '01310100' }])(
    'CEP %j nao consulta',
    async (cep) => {
      expect(await buscarEndereco(cep)).toBeNull();
      expect(buscaEnderecoPeloCep).not.toHaveBeenCalled();
    }
  );

  it.each(['cep-desconhecido', 'cep-invalido', 'fora-do-ar'] as const)(
    'falha (%s) vira null, sem mensagem: a pessoa digita',
    async (motivo) => {
      vi.mocked(buscaEnderecoPeloCep).mockResolvedValue({ ok: false, motivo });
      expect(await buscarEndereco('01310100')).toBeNull();
    }
  );

  it('para depois de trinta buscas em dez minutos', async () => {
    for (let i = 0; i < 30; i++) expect(await buscarEndereco('01310100')).toEqual(PAULISTA);
    expect(await buscarEndereco('01310100')).toBeNull();
    expect(buscaEnderecoPeloCep).toHaveBeenCalledTimes(30);
  });
});
