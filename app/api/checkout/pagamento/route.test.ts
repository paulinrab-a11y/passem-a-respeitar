import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResultadoDaCobranca } from '@/lib/loja/cobranca';

/**
 * A rota e fina: autentica, limita e delega a `cobra()`. O que se prova aqui
 * e a traducao do motivo em HTTP e recado — em especial que problema NOSSO
 * (credencial recusada pelo provedor) nao chega a pessoa como "nao aprovado",
 * que a mandaria tentar outro cartao a toa (#23).
 */
const cobra = vi.fn<(bruto: unknown) => Promise<ResultadoDaCobranca>>();
const limita = vi.fn<() => Promise<{ permitido: boolean; esperarS: number }>>();
const usuarioDaSessao = vi.fn<() => Promise<{ id: string; email: string } | null>>();

vi.mock('@/lib/loja/cobranca', () => ({ cobra: (b: unknown) => cobra(b) }));
vi.mock('@/lib/rate-limit', () => ({ limita: () => limita() }));
vi.mock('@/lib/supabase/servidor', () => ({ usuarioDaSessao: () => usuarioDaSessao() }));

const { POST } = await import('./route');

const PEDIDO = '11111111-2222-4333-8444-555555555555';

const pede = (corpo: unknown = { pedido: PEDIDO, payment_method_id: 'pix' }) =>
  POST(
    new NextRequest('https://passem-a-respeitar.test/api/checkout/pagamento', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo),
    })
  );

// `clearAllMocks` limpa as chamadas, nao o que cada duble responde: o estado
// de cada teste e refeito aqui para o "sem sessao" nao vazar para os outros.
beforeEach(() => {
  vi.clearAllMocks();
  cobra.mockResolvedValue({ ok: true, estado: 'aprovado' });
  limita.mockResolvedValue({ permitido: true, esperarS: 0 });
  usuarioDaSessao.mockResolvedValue({ id: 'uuu-1', email: 'quem@exemplo.test' });
});

describe('POST /api/checkout/pagamento', () => {
  it('devolve so o estado quando aprovou', async () => {
    const r = await pede();

    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ estado: 'aprovado' });
  });

  it('sem sessao e 401 e nao cobra', async () => {
    usuarioDaSessao.mockResolvedValue(null);

    const r = await pede();

    expect(r.status).toBe(401);
    expect(cobra).not.toHaveBeenCalled();
  });

  it('fora da cota e 429 com Retry-After e nao cobra', async () => {
    limita.mockResolvedValue({ permitido: false, esperarS: 120 });

    const r = await pede();

    expect(r.status).toBe(429);
    expect(r.headers.get('Retry-After')).toBe('120');
    expect(cobra).not.toHaveBeenCalled();
  });

  // Cartao recusado e 402 e "nao aprovado": cabe outro cartao.
  it('recusado e 402 com "nao aprovado"', async () => {
    cobra.mockResolvedValue({ ok: false, motivo: 'recusado' });

    const r = await pede();

    expect(r.status).toBe(402);
    expect((await r.json()).erro).toMatch(/não foi aprovado/);
  });

  // Credencial recusada pelo provedor e problema nosso: a pessoa le que o
  // pagamento esta indisponivel, nao que o cartao dela falhou.
  it('configuracao e 502 com "indisponível", nunca "não aprovado"', async () => {
    cobra.mockResolvedValue({ ok: false, motivo: 'configuracao' });

    const r = await pede();
    const corpo = await r.json();

    expect(r.status).toBe(502);
    expect(corpo.erro).toContain('O pagamento está indisponível no momento');
    expect(corpo.erro).not.toMatch(/aprovado/);
  });

  it.each([
    ['entrada-invalida', 400],
    ['pedido-nao-encontrado', 404],
    ['pedido-ja-pago', 409],
    ['tentativas-demais', 429],
    ['indisponivel', 502],
    ['pagamento-em-processamento', 409],
    ['pagamento-pendente', 409],
  ] as const)('%s vira HTTP %i', async (motivo, status) => {
    cobra.mockResolvedValue({ ok: false, motivo });

    const r = await pede();

    expect(r.status).toBe(status);
    expect(typeof (await r.json()).erro).toBe('string');
  });

  // Nada de objeto cru do provedor: so o que a tela precisa.
  it('a resposta de erro tem so o recado', async () => {
    cobra.mockResolvedValue({ ok: false, motivo: 'configuracao' });

    expect(Object.keys(await (await pede()).json())).toEqual(['erro']);
  });
});
