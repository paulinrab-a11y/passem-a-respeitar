// @vitest-environment jsdom

import { cleanup, fireEvent, render } from '@testing-library/react';
import type { ImgHTMLAttributes } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// O next/image de verdade precisa do servidor de otimizacao. Aqui interessa o
// que o componente PEDE a ele — largura, sizes, loading — e o que faz quando
// a foto responde.
vi.mock('next/image', () => ({
  default: ({
    priority,
    ...resto
  }: ImgHTMLAttributes<HTMLImageElement> & { priority?: boolean }) => (
    // biome-ignore lint/performance/noImgElement: duble do next/image no teste
    // biome-ignore lint/a11y/useAltText: o alt vem em `resto`
    <img data-priority={priority ? 'sim' : undefined} {...resto} />
  ),
}));

import Galeria from './Galeria';

const FOTOS = ['/m/1.jpg', '/m/2.jpg', '/m/3.jpg', '/m/4.jpg', '/m/5.jpg'];

afterEach(cleanup);

function monta() {
  const { container } = render(<Galeria fotos={FOTOS} alt="Camiseta de teste" />);
  return {
    figuras: () => [...container.querySelectorAll('figure')],
    fotos: () => [...container.querySelectorAll('img')],
  };
}

describe('galeria da merch (#47)', () => {
  it('uma moldura por foto, na ordem, com o nome do produto no alt', () => {
    const g = monta();

    expect(g.figuras()).toHaveLength(FOTOS.length);
    expect(g.fotos().map((f) => f.getAttribute('src'))).toEqual(FOTOS);
    expect(g.fotos().every((f) => f.getAttribute('alt') === 'Camiseta de teste')).toBe(true);
  });

  it('todas preguicosas, nenhuma com priority: a galeria fica abaixo da dobra', () => {
    const g = monta();

    expect(g.fotos().every((f) => f.getAttribute('loading') === 'lazy')).toBe(true);
    expect(g.fotos().some((f) => f.dataset.priority === 'sim')).toBe(false);
  });

  it('pede largura de acordo com a moldura: inteira, metade, um terco', () => {
    const sizes = monta()
      .fotos()
      .map((f) => f.getAttribute('sizes'));

    expect(sizes[0]).toContain('50vw');
    expect(sizes[1]).toBe(sizes[2]);
    expect(sizes[1]).toContain('25vw');
    expect(sizes[3]).toBe(sizes[4]);
    expect(sizes[3]).toContain('17vw');
    // No telefone a primeira ocupa a largura toda.
    expect(sizes[0]).toContain('(max-width: 767px) 100vw');
  });

  it('reserva o espaco em 3:2, a proporcao da moldura', () => {
    for (const f of monta().fotos()) {
      const razao = Number(f.getAttribute('width')) / Number(f.getAttribute('height'));
      expect(razao).toBeCloseTo(1.5, 2);
    }
  });

  it('a moldura so ganha `ok` quando a foto DELA responde', () => {
    const g = monta();
    expect(g.figuras().some((f) => f.classList.contains('ok'))).toBe(false);

    fireEvent.load(g.fotos()[1]);

    expect(g.figuras().map((f) => f.classList.contains('ok'))).toEqual([
      false,
      true,
      false,
      false,
      false,
    ]);
  });

  it('erro tambem encerra o brilho: foto que nao veio nao carrega para sempre', () => {
    const g = monta();

    fireEvent.error(g.fotos()[3]);

    expect(g.figuras()[3].classList.contains('ok')).toBe(true);
  });
});
