import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * O que a rota acrescenta ao `processa`: o aviso ao Sentry quando recusa
 * (#273). A decisao de recusar e testada em lib/loja/webhook.test.ts; aqui o
 * resultado e mockado e se confere quem avisa e com o que.
 */

const processa = vi.fn();
vi.mock('@/lib/loja/webhook', () => ({
  processa: (...args: unknown[]) => processa(...args),
}));

const avisaRecusa = vi.fn(async (_recusa: { motivo: string; assinatura: string }) => {});
vi.mock('@/lib/loja/aviso-de-recusa', () => ({
  avisaRecusa: (recusa: { motivo: string; assinatura: string }) => avisaRecusa(recusa),
}));

const { POST } = await import('./route');

let ultimoIp = 0;

/** IP proprio por caso: o limite por IP da rota e outro assunto. */
function notificacao(cabecalhos: Record<string, string> = {}) {
  ultimoIp += 1;
  return new Request('https://passem-a-respeitar.test/api/mercado-pago/webhook?data.id=ORD123', {
    method: 'POST',
    headers: { 'x-forwarded-for': `198.51.100.${ultimoIp}`, ...cabecalhos },
    body: JSON.stringify({ type: 'order', data: { id: 'ORD123' } }),
  }) as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('webhook recusado avisa o Sentry (#273)', () => {
  it('sem segredo configurado: 401 e aviso com o motivo da assinatura', async () => {
    vi.stubEnv('MERCADOPAGO_WEBHOOK_SECRET', '');
    vi.stubEnv('MERCADOPAGO_WEBHOOK_SECRET_ALT', '');
    processa.mockResolvedValueOnce({ tipo: 'recusado', motivo: 'nao-assinado-fora-do-sandbox' });

    const r = await POST(notificacao());

    expect(r.status).toBe(401);
    expect(avisaRecusa).toHaveBeenCalledWith({
      motivo: 'nao-assinado-fora-do-sandbox',
      assinatura: 'sem-segredo',
    });
  });

  it('assinatura que nao confere: aviso diz nao-confere, e nada do corpo vai junto', async () => {
    vi.stubEnv('MERCADOPAGO_WEBHOOK_SECRET', 'segredo-de-teste');
    processa.mockResolvedValueOnce({ tipo: 'recusado', motivo: 'nao-assinado-fora-do-sandbox' });

    const r = await POST(
      notificacao({
        'x-signature': `ts=${Date.now()},v1=${'0'.repeat(64)}`,
        'x-request-id': 'req-1',
      })
    );

    expect(r.status).toBe(401);
    expect(avisaRecusa).toHaveBeenCalledTimes(1);
    const [recusa] = avisaRecusa.mock.calls[0] ?? [];
    expect(recusa).toEqual({ motivo: 'nao-assinado-fora-do-sandbox', assinatura: 'nao-confere' });
    expect(JSON.stringify(recusa)).not.toContain('ORD123');
    expect(JSON.stringify(recusa)).not.toContain('segredo-de-teste');
  });

  it.each([
    ['aplicado', { tipo: 'aplicado', estado: 'aprovado' }, 200],
    ['ignorado', { tipo: 'ignorado', motivo: 'evento-repetido' }, 200],
    ['tente-de-novo', { tipo: 'tente-de-novo', motivo: 'provedor-indisponivel' }, 500],
  ])('%s: nao avisa de recusa', async (_caso, resultado, status) => {
    processa.mockResolvedValueOnce(resultado);

    const r = await POST(notificacao());

    expect(r.status).toBe(status);
    expect(avisaRecusa).not.toHaveBeenCalled();
  });
});
