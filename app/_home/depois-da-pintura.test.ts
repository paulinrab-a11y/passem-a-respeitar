// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { depoisDaPintura } from './depois-da-pintura';

/**
 * A espera antes do init da cena (#377): um quadro, uma tarefa nova e um
 * momento ocioso com teto. Os relogios sao dubles, para a ordem ficar
 * visivel.
 */
type Janela = Window & { requestIdleCallback?: Window['requestIdleCallback'] };

function janelaDuble({ oculta = false, ocioso = true } = {}) {
  const quadros: FrameRequestCallback[] = [];
  const ociosos: { fn: IdleRequestCallback; opcoes?: IdleRequestOptions }[] = [];
  const janela = {
    document: { hidden: oculta },
    requestAnimationFrame: (fn: FrameRequestCallback) => quadros.push(fn),
    setTimeout: (fn: () => void, ms?: number) => setTimeout(fn, ms),
    ...(ocioso
      ? {
          requestIdleCallback: (fn: IdleRequestCallback, opcoes?: IdleRequestOptions) =>
            ociosos.push({ fn, opcoes }),
        }
      : {}),
  } as unknown as Janela;
  return { janela, quadros, ociosos };
}

const terminou = async (p: Promise<void>) => {
  let foi = false;
  p.then(() => {
    foi = true;
  });
  await vi.advanceTimersByTimeAsync(5);
  return foi;
};

afterEach(() => {
  vi.useRealTimers();
});

describe('depoisDaPintura', () => {
  it('espera um quadro, depois uma tarefa, depois o ocioso com teto', async () => {
    vi.useFakeTimers();
    const { janela, quadros, ociosos } = janelaDuble();
    const espera = depoisDaPintura(janela, 800);

    // Sem quadro, nada anda.
    expect(await terminou(espera)).toBe(false);
    expect(quadros).toHaveLength(1);
    expect(ociosos).toHaveLength(0);

    quadros[0]?.(0);
    expect(await terminou(espera)).toBe(false);
    expect(ociosos).toHaveLength(1);
    expect(ociosos[0]?.opcoes).toEqual({ timeout: 800 });

    ociosos[0]?.fn({ didTimeout: false, timeRemaining: () => 10 });
    expect(await terminou(espera)).toBe(true);
  });

  it('sem requestIdleCallback (Safari), segue por tarefa depois do quadro', async () => {
    vi.useFakeTimers();
    const { janela, quadros } = janelaDuble({ ocioso: false });
    const espera = depoisDaPintura(janela);

    quadros[0]?.(0);
    expect(await terminou(espera)).toBe(true);
  });

  it('com a aba em segundo plano, nao espera um quadro que nao vem', async () => {
    vi.useFakeTimers();
    const { janela, quadros, ociosos } = janelaDuble({ oculta: true });
    const espera = depoisDaPintura(janela);

    await vi.advanceTimersByTimeAsync(5);
    expect(quadros).toHaveLength(0);
    expect(ociosos).toHaveLength(1);
    ociosos[0]?.fn({ didTimeout: true, timeRemaining: () => 0 });
    expect(await terminou(espera)).toBe(true);
  });
});
