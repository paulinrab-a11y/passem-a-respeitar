// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const replace = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace }) }));

const { default: Escolha } = await import('./Escolha');

/**
 * O seletor do checkout (#356). A troca e so de URL: quem refaz o preco e o
 * servidor, e quem guarda o endereco e o formulario que nao desmonta. O que
 * se prova aqui e a URL que sai de cada clique.
 */
function monta(tamanho: string | null = 'M', quantidade = 1) {
  return render(
    <Escolha
      slug="camiseta-cbac"
      tamanhos={['P', 'M', 'G']}
      tamanho={tamanho}
      quantidade={quantidade}
      maximo={3}
    />
  );
}

const radio = (grupo: string, valor: string) =>
  screen
    .getByRole('group', { name: grupo })
    .querySelector(`input[value="${valor}"]`) as HTMLInputElement;

beforeEach(() => replace.mockClear());
afterEach(cleanup);

describe('Escolha (#356)', () => {
  it('marca o que veio da URL', () => {
    monta('M', 2);

    expect(radio('Tamanho', 'M').checked).toBe(true);
    expect(radio('Quantidade', '2').checked).toBe(true);
  });

  it('trocar o tamanho troca a URL, guardando a quantidade, sem rolar a pagina', async () => {
    monta('M', 2);

    await act(async () => {
      fireEvent.click(radio('Tamanho', 'G'));
    });

    expect(replace).toHaveBeenCalledWith('/checkout?p=camiseta-cbac&tam=G&q=2', {
      scroll: false,
    });
  });

  it('trocar a quantidade guarda o tamanho', async () => {
    monta('P', 1);

    await act(async () => {
      fireEvent.click(radio('Quantidade', '3'));
    });

    expect(replace).toHaveBeenCalledWith('/checkout?p=camiseta-cbac&tam=P&q=3', {
      scroll: false,
    });
  });

  it('produto sem tamanho so oferece a quantidade', () => {
    monta(null, 1);

    expect(screen.queryByRole('group', { name: 'Tamanho' })).toBeNull();
    expect(screen.getByRole('group', { name: 'Quantidade' })).toBeTruthy();
  });

  it('a quantidade vai de 1 ao maximo do checkout', () => {
    monta();

    const valores = [
      ...screen.getByRole('group', { name: 'Quantidade' }).querySelectorAll('input'),
    ].map((r) => r.value);
    expect(valores).toEqual(['1', '2', '3']);
  });
});
