// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ligaComprar } from './comprar';

/**
 * O Comprar da loja (#301): na mesma aba, fecha a loja e deixa o navegador
 * seguir para o checkout. O jsdom nao troca de pagina; um ouvinte no documento,
 * depois do botao, cancela a navegacao e guarda se ela teria acontecido.
 */
let navegaria: boolean[];
const segura = (e: Event) => {
  navegaria.push(!e.defaultPrevented);
  e.preventDefault();
};

function monta(href: string) {
  document.body.innerHTML = `<div id="loja"><a id="comprarLoja" href="${href}">Comprar</a></div>`;
  const link = document.getElementById('comprarLoja') as HTMLAnchorElement;
  const fecha = vi.fn();
  ligaComprar(link, fecha);
  return { link, fecha };
}

function clica(link: HTMLElement, extra: MouseEventInit = {}) {
  link.dispatchEvent(
    new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...extra })
  );
}

beforeEach(() => {
  navegaria = [];
  document.addEventListener('click', segura);
});

afterEach(() => {
  document.removeEventListener('click', segura);
  document.body.innerHTML = '';
});

describe('ligaComprar', () => {
  it('com produto, fecha a loja e deixa o checkout abrir na mesma aba', () => {
    const { link, fecha } = monta('/checkout?p=camiseta&tam=M');
    clica(link);
    expect(fecha).toHaveBeenCalledTimes(1);
    expect(navegaria).toEqual([true]);
    expect(link.hasAttribute('target')).toBe(false);
  });

  it('Ctrl, Cmd, Shift e Alt abrem outra aba e a loja continua aberta', () => {
    const { link, fecha } = monta('/checkout?p=camiseta&tam=M');
    clica(link, { ctrlKey: true });
    clica(link, { metaKey: true });
    clica(link, { shiftKey: true });
    clica(link, { altKey: true });
    expect(fecha).not.toHaveBeenCalled();
    expect(navegaria).toEqual([true, true, true, true]);
  });

  it('botao do meio nao fecha a loja', () => {
    const { link, fecha } = monta('/checkout?p=camiseta&tam=M');
    link.dispatchEvent(new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 }));
    clica(link, { button: 1 });
    expect(fecha).not.toHaveBeenCalled();
  });

  it('sem produto no catalogo o destino e # e o clique nao faz nada', () => {
    const { link, fecha } = monta('#');
    clica(link);
    expect(fecha).not.toHaveBeenCalled();
    expect(navegaria).toEqual([false]);
  });
});
