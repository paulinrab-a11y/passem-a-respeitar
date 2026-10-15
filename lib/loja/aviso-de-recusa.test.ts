import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Aviso de webhook recusado (#273). O que se prova: vai so motivo e
 * assinatura, em tag, como warning; e uma rajada de robo nao vira um evento
 * por request.
 */

const captureMessage = vi.fn();
vi.mock('@sentry/nextjs', () => ({
  captureMessage: (...args: unknown[]) => captureMessage(...args),
}));

const enviaDepois = vi.fn();
vi.mock('@/lib/sentry/depois', () => ({ enviaDepois: () => enviaDepois() }));

beforeEach(() => {
  vi.clearAllMocks();
  // O orcamento vive na memoria do modulo de rate limit (sem Upstash no
  // teste). Modulo novo por caso, para um caso nao gastar a cota do outro.
  vi.resetModules();
  vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
  vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
});

describe('avisaRecusa', () => {
  it('manda warning com as duas tags, e nada alem delas', async () => {
    const { avisaRecusa } = await import('./aviso-de-recusa');

    await avisaRecusa({ motivo: 'nao-assinado-fora-do-sandbox', assinatura: 'nao-confere' });

    expect(captureMessage).toHaveBeenCalledTimes(1);
    expect(captureMessage).toHaveBeenCalledWith('webhook do mercado pago recusado', {
      level: 'warning',
      tags: { motivo: 'nao-assinado-fora-do-sandbox', assinatura: 'nao-confere' },
    });
    expect(enviaDepois).toHaveBeenCalledTimes(1);
  });

  it('rajada: so os primeiros da janela viram evento', async () => {
    const { avisaRecusa, ORCAMENTO_DE_AVISOS } = await import('./aviso-de-recusa');

    for (let i = 0; i < ORCAMENTO_DE_AVISOS.maximo + 20; i += 1) {
      await avisaRecusa({ motivo: 'nao-assinado-fora-do-sandbox', assinatura: 'sem-assinatura' });
    }

    expect(captureMessage).toHaveBeenCalledTimes(ORCAMENTO_DE_AVISOS.maximo);
    expect(enviaDepois).toHaveBeenCalledTimes(ORCAMENTO_DE_AVISOS.maximo);
  });

  // Com uma cota so, o robo sem assinatura gastava a janela e o segredo
  // trocado no painel (`nao-confere`) nunca chegava ao Sentry.
  it('rajada de robo sem assinatura nao esconde o primeiro nao-confere', async () => {
    const { avisaRecusa, ORCAMENTO_DE_AVISOS } = await import('./aviso-de-recusa');

    for (let i = 0; i < ORCAMENTO_DE_AVISOS.maximo + 20; i += 1) {
      await avisaRecusa({ motivo: 'nao-assinado-fora-do-sandbox', assinatura: 'sem-assinatura' });
    }
    captureMessage.mockClear();

    await avisaRecusa({ motivo: 'nao-assinado-fora-do-sandbox', assinatura: 'nao-confere' });

    expect(captureMessage).toHaveBeenCalledTimes(1);
    expect(captureMessage).toHaveBeenCalledWith('webhook do mercado pago recusado', {
      level: 'warning',
      tags: { motivo: 'nao-assinado-fora-do-sandbox', assinatura: 'nao-confere' },
    });
  });

  it('o orcamento e pequeno: poucos por hora', async () => {
    const { ORCAMENTO_DE_AVISOS } = await import('./aviso-de-recusa');

    expect(ORCAMENTO_DE_AVISOS.maximo).toBeLessThanOrEqual(10);
    expect(ORCAMENTO_DE_AVISOS.janelaMs).toBeGreaterThanOrEqual(60 * 60 * 1000);
  });
});
