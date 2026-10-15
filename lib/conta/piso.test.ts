import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { seguraAtePiso } from './piso';

/** O piso das acoes que mandam e-mail (#352). */
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

/** Comeca a esperar e devolve uma funcao que diz se ja soltou. */
function espera(inicio: number) {
  let soltou = false;
  void seguraAtePiso(inicio).then(() => {
    soltou = true;
  });
  return () => soltou;
}

describe('seguraAtePiso', () => {
  it('caminho rapido espera ate o piso', async () => {
    vi.stubEnv('CONTA_PISO_MS', '1500');
    const soltou = espera(Date.now());

    await vi.advanceTimersByTimeAsync(1499);
    expect(soltou()).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(soltou()).toBe(true);
  });

  it('caminho que ja demorou mais que o piso nao espera mais nada', async () => {
    vi.stubEnv('CONTA_PISO_MS', '1500');
    const soltou = espera(Date.now() - 2000);

    await vi.advanceTimersByTimeAsync(0);
    expect(soltou()).toBe(true);
  });

  it('sem a variavel, o piso e de 1,5 s', async () => {
    const antes = process.env.CONTA_PISO_MS;
    delete process.env.CONTA_PISO_MS;
    try {
      const soltou = espera(Date.now());

      await vi.advanceTimersByTimeAsync(1499);
      expect(soltou()).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(soltou()).toBe(true);
    } finally {
      process.env.CONTA_PISO_MS = antes;
    }
  });
});
