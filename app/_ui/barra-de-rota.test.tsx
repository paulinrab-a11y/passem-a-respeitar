// @vitest-environment jsdom

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BarraDeRota from './BarraDeRota';
import { ehNavegacao } from './barra-de-rota';

// A origem e a do documento de teste: `link.href` e resolvido pelo navegador
// contra a pagina em que o link esta, como acontece de verdade.
const AQUI = { origin: window.location.origin, pathname: '/conta', search: '' };

function link(href: string, atributos: Record<string, string> = {}) {
  const a = document.createElement('a');
  a.setAttribute('href', href);
  for (const [k, v] of Object.entries(atributos)) a.setAttribute(k, v);
  const dentro = document.createElement('span');
  a.appendChild(dentro);
  document.body.appendChild(a);
  return { a, dentro };
}

function clique(target: EventTarget, extra: Partial<MouseEvent> = {}) {
  return {
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    defaultPrevented: false,
    target,
    ...extra,
  };
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('ehNavegacao', () => {
  it('link para outra pagina deste site', () => {
    expect(ehNavegacao(clique(link(`${AQUI.origin}/conta/pedidos`).a), AQUI)).toBe(true);
  });

  it('caminho relativo resolve contra a origem', () => {
    expect(ehNavegacao(clique(link('/conta/seguranca').a), AQUI)).toBe(true);
  });

  it('clique num filho do link conta como clique no link', () => {
    expect(ehNavegacao(clique(link('/entrar').dentro), AQUI)).toBe(true);
  });

  it('mesma pagina com outra query e navegacao', () => {
    expect(ehNavegacao(clique(link('/conta?p=2').a), AQUI)).toBe(true);
  });

  it.each([
    ['so a ancora mudou', '/conta#topo', {}],
    ['outro site', 'https://outro.exemplo/conta', {}],
    ['e-mail', 'mailto:alguem@exemplo.invalid', {}],
    ['nova aba', '/conta/pedidos', { target: '_blank' }],
    ['download', '/arquivo.pdf', { download: '' }],
  ])('%s nao liga a barra', (_nome, href, atributos) => {
    expect(ehNavegacao(clique(link(href, atributos).a), AQUI)).toBe(false);
  });

  it.each([
    ['botao do meio', { button: 1 }],
    ['ctrl', { ctrlKey: true }],
    ['cmd', { metaKey: true }],
    ['shift', { shiftKey: true }],
    ['alt', { altKey: true }],
    ['cancelado por outro handler', { defaultPrevented: true }],
  ])('%s nao liga a barra', (_nome, extra) => {
    expect(ehNavegacao(clique(link('/conta/pedidos').a, extra), AQUI)).toBe(false);
  });

  it('clique fora de link', () => {
    const botao = document.createElement('button');
    document.body.appendChild(botao);

    expect(ehNavegacao(clique(botao), AQUI)).toBe(false);
  });

  it('alvo que nao e elemento', () => {
    expect(ehNavegacao(clique(document), AQUI)).toBe(false);
  });
});

describe('BarraDeRota', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  const barra = (c: HTMLElement) => c.querySelector('.barra-rota') as HTMLElement;
  // O jsdom nao navega; o clique so precisa chegar ao documento.
  const clica = (el: Element) =>
    act(() => {
      fireEvent.click(el);
    });

  it('nasce apagada e fora da arvore de acessibilidade', () => {
    const { container } = render(<BarraDeRota />);

    expect(barra(container).classList.contains('on')).toBe(false);
    expect(barra(container).getAttribute('aria-hidden')).toBe('true');
    expect(barra(container).getAttribute('role')).toBe('progressbar');
  });

  it('liga no clique de um link para outra pagina', () => {
    const { container } = render(<BarraDeRota />);

    clica(link('/outra-pagina').a);

    expect(barra(container).classList.contains('on')).toBe(true);
    expect(barra(container).getAttribute('aria-hidden')).toBeNull();
    expect(barra(container).getAttribute('aria-busy')).toBe('true');
  });

  it('nao liga em ancora da mesma pagina', () => {
    const { container } = render(<BarraDeRota />);

    clica(link(`${window.location.pathname}#merch`).a);

    expect(barra(container).classList.contains('on')).toBe(false);
  });

  it('liga em navegacao disparada por codigo', () => {
    const { container } = render(<BarraDeRota />);

    act(() => {
      window.dispatchEvent(new Event('beforeunload'));
    });

    expect(barra(container).classList.contains('on')).toBe(true);
  });

  it('apaga quando a pagina volta do cache do historico', () => {
    const { container } = render(<BarraDeRota />);
    clica(link('/outra-pagina').a);

    act(() => {
      const volta = new Event('pageshow');
      Object.defineProperty(volta, 'persisted', { value: true });
      window.dispatchEvent(volta);
    });

    expect(barra(container).classList.contains('on')).toBe(false);
  });

  it('pageshow de carregamento normal nao mexe na barra', () => {
    const { container } = render(<BarraDeRota />);
    clica(link('/outra-pagina').a);

    act(() => {
      const chegada = new Event('pageshow');
      Object.defineProperty(chegada, 'persisted', { value: false });
      window.dispatchEvent(chegada);
    });

    expect(barra(container).classList.contains('on')).toBe(true);
  });

  it('navegacao que nao aconteceu: a barra apaga sozinha em dez segundos', () => {
    const { container } = render(<BarraDeRota />);
    clica(link('/outra-pagina').a);

    act(() => {
      vi.advanceTimersByTime(9_999);
    });
    expect(barra(container).classList.contains('on')).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(barra(container).classList.contains('on')).toBe(false);
  });

  it('desmontada, para de escutar', () => {
    const { container, unmount } = render(<BarraDeRota />);
    const el = barra(container);
    unmount();

    clica(link('/outra-pagina').a);

    expect(el.classList.contains('on')).toBe(false);
  });
});
