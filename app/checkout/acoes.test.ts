import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A acao e fina de proposito — quem decide dinheiro e a `criaPedido`, que tem
 * os proprios testes. O que se prova aqui e o que a PESSOA ve: qual mensagem,
 * qual campo recebe foco, e que o sucesso leva para o pedido.
 */
vi.mock('@/lib/supabase/servidor', () => ({ usuarioDaSessao: vi.fn() }));
vi.mock('@/lib/loja/pedido', () => ({ criaPedido: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: vi.fn(() => {
    // O `redirect` do Next lanca para interromper a execucao. O duble imita
    // isso; sem lancar, o teste nao distingue "redirecionou" de "seguiu".
    throw new Error('NEXT_REDIRECT');
  }),
}));

const { usuarioDaSessao } = await import('@/lib/supabase/servidor');
const { criaPedido } = await import('@/lib/loja/pedido');
const { redirect } = await import('next/navigation');
const { finalizarCompra } = await import('./acoes');
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
