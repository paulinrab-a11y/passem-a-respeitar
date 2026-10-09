import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A tela de pagamento e a venda sem quem vende identificado (#276).
 *
 * Em producao, sem nome, documento e endereco de quem vende, a tela nao monta
 * o pagamento: mostra o mesmo "fora do ar" de quando falta a chave do Mercado
 * Pago. O Brick e um duble — o que se prova e se ele e montado ou nao.
 */
vi.mock('@sentry/nextjs', () => ({ captureMessage: vi.fn(), flush: async () => true }));
vi.mock('@/lib/sentry/depois', () => ({ enviaDepois: vi.fn() }));
vi.mock('@/lib/supabase/servidor', () => ({
  usuarioDaSessao: vi.fn(async () => ({ id: 'pessoa', email: 'pessoa@exemplo.test' })),
}));
vi.mock('@/app/conta/pedidos/[id]/busca-pedido', () => ({ meuPedido: vi.fn() }));
vi.mock('./Brick', () => ({ default: () => <div data-brick="montado" /> }));

const { meuPedido } = await import('@/app/conta/pedidos/[id]/busca-pedido');
const { default: Pagamento } = await import('./page');

const PEDIDO = '44444444-4444-4444-8444-444444444444';
const FORA_DO_AR = 'O pagamento está fora do ar no momento.';

async function tela() {
  const jsx = await Pagamento({ params: Promise.resolve({ id: PEDIDO }) });
  return renderToStaticMarkup(jsx);
}

function vendedor(cadastrado: boolean) {
  vi.stubEnv('VENDEDOR_NOME', cadastrado ? 'Loja de Teste Ltda' : '');
  vi.stubEnv('VENDEDOR_DOCUMENTO', cadastrado ? '00.000.000/0001-00' : '');
  vi.stubEnv('VENDEDOR_ENDERECO', cadastrado ? 'Rua de Teste, 1, Cidade - UF' : '');
}

beforeEach(() => {
  vi.mocked(meuPedido).mockResolvedValue({
    tipo: 'ok',
    pedido: {
      numero: 7,
      criadoEm: '2026-10-09T12:00:00Z',
      rotulo: 'Aguardando pagamento',
      tom: 'atencao',
      total: 'R$ 143,50',
      totalCentavos: 14350,
      aguardandoPagamento: true,
      frete: null,
      entrega: null,
      itens: [],
      linhaDoTempo: { etapas: [], ramo: null, semRegistro: true },
      posVenda: { etapa: 'sem-pagamento' },
    },
  });
  vi.stubEnv('NEXT_PUBLIC_MERCADOPAGO_PUBLIC_KEY', 'TEST-chave-publica-de-teste');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('pagamento e quem vende (#276)', () => {
  it('em producao, sem os dados de quem vende, nao monta o pagamento', async () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    vendedor(false);

    const html = await tela();

    expect(html).not.toContain('data-brick');
    expect(html).toContain(FORA_DO_AR);
    // O pedido nao se perde: a tela diz isso, e o valor continua ali.
    expect(html).toContain('Seu pedido está salvo');
  });

  it('em producao, com os dados, monta o pagamento como sempre', async () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    vendedor(true);

    const html = await tela();

    expect(html).toContain('data-brick="montado"');
    expect(html).not.toContain(FORA_DO_AR);
  });

  it('em preview, sem os dados, monta o pagamento de teste', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    vendedor(false);

    expect(await tela()).toContain('data-brick="montado"');
  });

  // O caminho que ja existia, para a chave que falta: o mesmo recado.
  it('sem a chave publica, o mesmo recado de fora do ar', async () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    vendedor(true);
    vi.stubEnv('NEXT_PUBLIC_MERCADOPAGO_PUBLIC_KEY', '');

    const html = await tela();
    expect(html).not.toContain('data-brick');
    expect(html).toContain(FORA_DO_AR);
  });
});
