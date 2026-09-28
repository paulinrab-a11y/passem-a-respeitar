// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import Rotulo from './Rotulo';

afterEach(cleanup);

function monta(ativo: boolean) {
  const { container } = render(
    <button type="button">
      <Rotulo parado="Salvar" agindo="Salvando…" ativo={ativo} />
    </button>
  );
  const [parado, agindo] = [...container.querySelectorAll('.rotulo-acao > span')];
  return { raiz: container.querySelector('.rotulo-acao') as HTMLElement, parado, agindo };
}

describe('Rotulo (#50)', () => {
  it('os dois textos estao sempre no DOM: e isso que reserva a largura', () => {
    for (const ativo of [false, true]) {
      const r = monta(ativo);

      expect(r.parado.textContent).toBe('Salvar');
      expect(r.agindo.textContent).toBe('Salvando…');
      cleanup();
    }
  });

  it('parado: so o texto parado conta para quem ouve', () => {
    const r = monta(false);

    expect(r.raiz.hasAttribute('data-ativo')).toBe(false);
    expect(r.parado.getAttribute('aria-hidden')).toBeNull();
    expect(r.agindo.getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeTruthy();
  });

  it('agindo: o nome do botao passa a ser o da acao em andamento', () => {
    const r = monta(true);

    expect(r.raiz.hasAttribute('data-ativo')).toBe(true);
    expect(r.parado.getAttribute('aria-hidden')).toBe('true');
    expect(r.agindo.getAttribute('aria-hidden')).toBeNull();
    expect(screen.getByRole('button', { name: 'Salvando…' })).toBeTruthy();
  });
});
