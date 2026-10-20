// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ligaClipeNoCanto } from './clipe-no-canto';

/**
 * O teaser do Blick no canto VHS: so depois da pintura, mudo, em loop, e
 * desistindo sem barulho quando nao da para tocar.
 */
vi.mock('./depois-da-pintura', () => ({ depoisDaPintura: () => Promise.resolve() }));

let video: HTMLVideoElement;
let play: ReturnType<typeof vi.fn>;

beforeEach(() => {
  document.body.innerHTML = '<video id="canto" preload="none"></video>';
  video = document.getElementById('canto') as HTMLVideoElement;
  play = vi.fn(() => Promise.resolve());
  video.play = play as unknown as HTMLVideoElement['play'];
  video.pause = vi.fn();
  video.load = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const opcoes = { src: '/clipe/blick-canto.mp4', capa: '/clipe/blick-canto-poster.webp' };

describe('ligaClipeNoCanto', () => {
  it('escreve o src depois da pintura, mudo e em loop, e aparece quando toca', async () => {
    await ligaClipeNoCanto(document, window, { ...opcoes, reduz: false });

    expect(video.getAttribute('src')).toBe(opcoes.src);
    expect(video.muted).toBe(true);
    expect(video.loop).toBe(true);
    expect(play).toHaveBeenCalledTimes(1);
    expect(video.classList.contains('on')).toBe(false);

    video.dispatchEvent(new Event('playing'));
    expect(video.classList.contains('on')).toBe(true);
  });

  it('com movimento reduzido mostra so a capa, sem tocar', async () => {
    await ligaClipeNoCanto(document, window, { ...opcoes, reduz: true });

    expect(video.getAttribute('src')).toBeNull();
    expect(video.getAttribute('poster')).toBe(opcoes.capa);
    expect(video.classList.contains('on')).toBe(true);
    expect(play).not.toHaveBeenCalled();
  });

  it('autoplay recusado: some e fica o grao', async () => {
    play.mockImplementation(() =>
      Promise.reject(Object.assign(new Error('nao'), { name: 'NotAllowedError' }))
    );
    await ligaClipeNoCanto(document, window, { ...opcoes, reduz: false });
    await Promise.resolve();

    expect(video.getAttribute('src')).toBeNull();
    expect(video.classList.contains('on')).toBe(false);
  });

  it('arquivo que falha: some e fica o grao', async () => {
    await ligaClipeNoCanto(document, window, { ...opcoes, reduz: false });
    video.dispatchEvent(new Event('playing'));
    video.dispatchEvent(new Event('error'));

    expect(video.getAttribute('src')).toBeNull();
    expect(video.classList.contains('on')).toBe(false);
  });

  it('pausa com a aba escondida e volta com ela', async () => {
    await ligaClipeNoCanto(document, window, { ...opcoes, reduz: false });
    const oculta = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(video.pause).toHaveBeenCalled();

    oculta.mockReturnValue(false);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(play).toHaveBeenCalledTimes(2);
  });

  it('liga uma vez so', async () => {
    await ligaClipeNoCanto(document, window, { ...opcoes, reduz: false });
    await ligaClipeNoCanto(document, window, { ...opcoes, reduz: false });

    expect(play).toHaveBeenCalledTimes(1);
  });
});
