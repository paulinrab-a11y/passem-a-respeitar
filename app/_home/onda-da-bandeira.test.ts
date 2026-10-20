// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import geometria from '@/lib/marca/bandeira-geometria.json';
import { MEIA_VOLTA, ondas, TIRAS, vigiaBandeira } from './onda-da-bandeira';

/**
 * A bandeira acima do pre-save: os numeros de cada tira e quando ela ondula.
 */
const proporcao = geometria.pano.altura / geometria.pano.largura;
const lista = ondas(proporcao);

describe('ondas', () => {
  it('uma por tira, da ponta solta ao mastro', () => {
    expect(lista).toHaveLength(TIRAS);
  });

  it('a amplitude cresce do mastro para a ponta, e e pequena', () => {
    const amplitudes = lista.map((o) => o.a);
    for (let i = 1; i < amplitudes.length; i++) {
      expect(amplitudes[i]).toBeLessThan(amplitudes[i - 1]);
    }
    // Junto ao mastro o tecido quase nao mexe; na ponta, poucos % da altura.
    expect(amplitudes.at(-1)).toBeLessThan(0.2);
    expect(amplitudes[0]).toBeLessThanOrEqual(5);
    expect(lista.every((o) => Math.abs(o.k) < 15)).toBe(true);
  });

  it('os atrasos sao negativos e dentro de uma volta: nenhuma tira espera parada', () => {
    for (const o of lista) {
      expect(o.d).toBeLessThanOrEqual(0);
      expect(o.d).toBeGreaterThan(-2 * MEIA_VOLTA);
      expect(o.d2).toBeLessThanOrEqual(0);
      expect(o.d2).toBeGreaterThan(-2 * MEIA_VOLTA);
    }
  });

  it('a inclinacao anda a frente da subida, entre um quarto e meia volta', () => {
    // Um quarto de volta e a derivada de uma onda de amplitude fixa; a
    // amplitude crescendo para a ponta puxa a fase para meia volta.
    for (const o of lista) {
      const diferenca = (((o.d - o.d2) % (2 * MEIA_VOLTA)) + 2 * MEIA_VOLTA) % (2 * MEIA_VOLTA);
      expect(diferenca).toBeGreaterThanOrEqual(MEIA_VOLTA / 2 - 0.01);
      expect(diferenca).toBeLessThanOrEqual(MEIA_VOLTA + 0.01);
    }
  });

  it('vizinhas tem fase proxima: a onda e continua', () => {
    const volta = 2 * MEIA_VOLTA;
    for (let i = 1; i < lista.length; i++) {
      const passo = (((lista[i].d - lista[i - 1].d) % volta) + volta) % volta;
      expect(Math.min(passo, volta - passo)).toBeLessThan(volta / 8);
    }
  });
});

describe('vigiaBandeira', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function comObservador() {
    let aviso: (es: { isIntersecting: boolean }[]) => void = () => {};
    class Observador {
      constructor(fn: typeof aviso) {
        aviso = fn;
      }
      observe() {}
      disconnect() {}
    }
    vi.stubGlobal('IntersectionObserver', Observador);
    return (naTela: boolean) => aviso([{ isIntersecting: naTela }]);
  }

  it('so ondula na tela', () => {
    const avisa = comObservador();
    const el = document.createElement('div');
    vigiaBandeira(el, window);

    expect(el.classList.contains('ondula')).toBe(false);
    avisa(true);
    expect(el.classList.contains('ondula')).toBe(true);
    avisa(false);
    expect(el.classList.contains('ondula')).toBe(false);
  });

  it('para com a aba escondida e volta com ela', () => {
    const avisa = comObservador();
    const el = document.createElement('div');
    vigiaBandeira(el, window);
    avisa(true);

    const oculta = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(el.classList.contains('ondula')).toBe(false);

    oculta.mockReturnValue(false);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(el.classList.contains('ondula')).toBe(true);
    oculta.mockRestore();
  });
});

describe('CSS da bandeira', () => {
  const CSS = readFileSync('app/globals.css', 'utf8');

  it('nasce parada; quem solta e a classe ondula', () => {
    expect(CSS).toMatch(/\.bandeira \.tira\{[^}]*animation-play-state:paused/);
    expect(CSS).toMatch(/\.bandeira \.dobra\{[^}]*animation-play-state:paused/);
    expect(CSS).toContain(
      '.bandeira.ondula .tira,.bandeira.ondula .dobra{animation-play-state:running}'
    );
  });

  it('a onda so mexe em transform', () => {
    const quadros = [...CSS.matchAll(/@keyframes bandeira-[\w-]+\{(.*)\}\n/g)].map((m) => m[1]);
    expect(quadros).toHaveLength(2);
    for (const q of quadros) {
      const propriedades = [...q.matchAll(/([a-z-]+):/g)].map((m) => m[1]);
      expect(new Set(propriedades)).toEqual(new Set(['transform']));
    }
  });
});
