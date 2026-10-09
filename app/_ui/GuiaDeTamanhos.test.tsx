// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { fimDaAnimacao } from './fim-da-animacao';
import GuiaDeTamanhos from './GuiaDeTamanhos';

/**
 * O guia de tamanhos (#206). O jsdom nao implementa `showModal` e `close`
 * de <dialog>; os dois ganham um duble que mexe no atributo `open`, que e o
 * que o componente e o CSS leem. Foco preso e fundo inerte sao do navegador,
 * e e a suite de ponta a ponta que os confere.
 *
 * O fim da animacao e disparado pelo `fimDaAnimacao`: no jsdom o React ouve
 * `webkitAnimationEnd`, e nao `animationend`.
 */

const LINHAS = [
  { tamanho: 'P', altura: 79, largura: 67, manga: 23 },
  { tamanho: 'GG', altura: 84, largura: 74, manga: 26 },
];

beforeAll(() => {
  const proto = HTMLDialogElement.prototype as HTMLDialogElement & {
    showModal: () => void;
    close: () => void;
  };
  if (typeof proto.showModal !== 'function') {
    proto.showModal = function showModal(this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
    proto.close = function close(this: HTMLDialogElement) {
      this.removeAttribute('open');
      this.dispatchEvent(new Event('close'));
    };
  }
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const monta = () => render(<GuiaDeTamanhos linhas={LINHAS} produto="Camiseta CBAC" />);
const dialogo = (c: HTMLElement) => c.querySelector('dialog') as HTMLDialogElement;
const abre = () => fireEvent.click(screen.getByRole('button', { name: 'Guia de tamanhos' }));

describe('GuiaDeTamanhos', () => {
  it('nasce fechado, com o link e sem a tabela na tela', () => {
    const { container } = monta();
    expect(screen.getByRole('button', { name: 'Guia de tamanhos' })).toBeTruthy();
    expect(dialogo(container).open).toBe(false);
  });

  it('abre com a tabela, uma linha por tamanho, e como medir', () => {
    const { container } = monta();
    abre();

    expect(dialogo(container).open).toBe(true);
    expect(screen.getByRole('heading', { name: 'Guia de tamanhos' })).toBeTruthy();
    expect(screen.getByText('Camiseta CBAC. Medidas da peça, em centímetros.')).toBeTruthy();

    const linhas = container.querySelectorAll('tbody tr');
    expect(linhas).toHaveLength(2);
    expect(linhas[0].textContent).toBe('P796723');
    expect(linhas[1].textContent).toBe('GG847426');
    expect(container.querySelectorAll('.guia-como li')).toHaveLength(3);
  });

  it('a tabela e acessivel: cabecalhos de coluna e de linha', () => {
    const { container } = monta();
    abre();
    expect(container.querySelectorAll('thead th[scope="col"]')).toHaveLength(4);
    expect(container.querySelectorAll('tbody th[scope="row"]')).toHaveLength(2);
  });

  it('o modal tem o nome do proprio titulo', () => {
    const { container } = monta();
    abre();
    const titulo = container.querySelector('dialog h2') as HTMLHeadingElement;

    expect(titulo.id).not.toBe('');
    expect(dialogo(container).getAttribute('aria-labelledby')).toBe(titulo.id);
    expect(screen.getByRole('dialog', { name: 'Guia de tamanhos' })).toBe(dialogo(container));
  });

  // A home tem dois guias, um na ficha e outro na loja (#266). Com id fixo, os
  // dois apontavam para o primeiro <h2> e a pagina tinha id repetido.
  it('dois guias na mesma pagina nao repetem id', () => {
    const { container } = render(
      <>
        <GuiaDeTamanhos linhas={LINHAS} produto="Camiseta CBAC" />
        <GuiaDeTamanhos linhas={LINHAS} produto="Camiseta CBAC" />
      </>
    );
    const dialogos = [...container.querySelectorAll('dialog')];
    const titulos = [...container.querySelectorAll('dialog h2')].map((h) => h.id);

    expect(new Set(titulos).size).toBe(2);
    expect(dialogos.map((d) => d.getAttribute('aria-labelledby'))).toEqual(titulos);
  });

  it('fechar anima a saida, e so depois fecha de verdade', () => {
    vi.useFakeTimers();
    const { container } = monta();
    abre();

    fireEvent.click(screen.getByRole('button', { name: 'fechar' }));
    const d = dialogo(container);
    expect(d.classList.contains('saindo')).toBe(true);
    expect(d.open).toBe(true);

    fimDaAnimacao(d);
    expect(d.open).toBe(false);
    expect(d.classList.contains('saindo')).toBe(false);
  });

  it('sem animacao (movimento reduzido), o prazo fecha', () => {
    vi.useFakeTimers();
    const { container } = monta();
    abre();
    fireEvent.click(screen.getByRole('button', { name: 'fechar' }));

    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(dialogo(container).open).toBe(false);
  });

  it('Esc fecha, e nao sobe para quem esta em volta', () => {
    const { container } = monta();
    abre();
    const d = dialogo(container);
    const emVolta = vi.fn();
    window.addEventListener('keydown', emVolta);

    // O navegador traduz Esc num evento `cancel` no dialog...
    const cancel = new Event('cancel', { cancelable: true });
    d.dispatchEvent(cancel);
    expect(cancel.defaultPrevented).toBe(true);
    expect(d.classList.contains('saindo')).toBe(true);

    // ...e o keydown em si nao chega na janela, onde a loja da home ouve.
    fireEvent.keyDown(d, { key: 'Escape' });
    expect(emVolta).not.toHaveBeenCalled();
    window.removeEventListener('keydown', emVolta);
  });

  it('clique no fundo fecha; clique dentro da caixa nao', () => {
    const { container } = monta();
    abre();
    const d = dialogo(container);

    fireEvent.click(container.querySelector('.guia-tabela') as HTMLElement);
    expect(d.classList.contains('saindo')).toBe(false);

    fireEvent.click(d);
    expect(d.classList.contains('saindo')).toBe(true);
  });

  it('fechar duas vezes nao quebra, e abrir de novo limpa a saida', () => {
    vi.useFakeTimers();
    const { container } = monta();
    abre();
    const d = dialogo(container);
    fireEvent.click(screen.getByRole('button', { name: 'fechar' }));
    fireEvent.click(screen.getByRole('button', { name: 'fechar' }));
    fimDaAnimacao(d);
    expect(d.open).toBe(false);

    abre();
    expect(d.open).toBe(true);
    expect(d.classList.contains('saindo')).toBe(false);
  });
});
