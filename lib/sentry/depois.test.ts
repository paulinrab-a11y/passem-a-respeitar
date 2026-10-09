import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ESPERA_DO_ENVIO_MS, enviaDepois } from './depois';

/**
 * O envio ao Sentry depois da resposta (#281). O que se prova aqui: nada
 * espera o `flush` na hora, o `flush` sai quando o `after` roda, e fora de
 * um request o envio nao some.
 */

const flush = vi.fn(async (_ms?: number) => true);
vi.mock('@sentry/nextjs', () => ({ flush: (ms?: number) => flush(ms) }));

const after = vi.fn<(tarefa: () => unknown) => void>();
vi.mock('next/server', () => ({ after: (tarefa: () => unknown) => after(tarefa) }));

beforeEach(() => {
  flush.mockClear();
  after.mockReset();
});

describe('enviaDepois', () => {
  it('deixa o flush para depois da resposta', async () => {
    enviaDepois();

    expect(after).toHaveBeenCalledTimes(1);
    expect(flush).not.toHaveBeenCalled();

    // O que o Next faz quando a resposta ja saiu.
    await after.mock.calls[0]?.[0]();

    expect(flush).toHaveBeenCalledTimes(1);
    expect(flush).toHaveBeenCalledWith(ESPERA_DO_ENVIO_MS);
  });

  it('fora de um request, manda direto em vez de lancar', () => {
    after.mockImplementation(() => {
      throw new Error('`after` was called outside a request scope.');
    });

    expect(() => enviaDepois()).not.toThrow();
    expect(flush).toHaveBeenCalledWith(ESPERA_DO_ENVIO_MS);
  });
});
