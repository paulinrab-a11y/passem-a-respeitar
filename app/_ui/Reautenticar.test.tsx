// @vitest-environment jsdom

import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Reautenticar from './Reautenticar';

/**
 * O modal de reautenticacao como modal tambem para o teclado (#270): na tela,
 * o resto da pagina e inerte; ao sair, o foco volta para onde a pessoa
 * estava. O jsdom guarda o atributo `inert` sem aplicar o efeito; o Tab preso
 * de verdade e do navegador.
 *
 * Sem animacao no jsdom, quem desmonta o modal e o prazo do
 * `useDesmonteAnimado`, por isso os relogios falsos.
 */
function Tela({
  aberto,
  devolverFoco,
}: {
  aberto: boolean;
  devolverFoco?: () => HTMLElement | null;
}) {
  return (
    <main>
      <button type="button">Encerrar</button>
      <Reautenticar
        aberto={aberto}
        onCancelar={() => {}}
        onConfirmar={() => {}}
        erro={null}
        pendente={false}
        minutos={5}
        devolverFoco={devolverFoco}
      />
    </main>
  );
}

const encerrar = () => screen.getByRole('button', { name: 'Encerrar' });
const campo = () => screen.getByLabelText('Senha');

/** Fecha e espera o prazo de saida desmontar o modal. */
function fechaESai(rerender: (ui: React.ReactElement) => void, ui: React.ReactElement) {
  rerender(ui);
  act(() => {
    vi.advanceTimersByTime(500);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Reautenticar', () => {
  it('na tela, o resto da pagina fica inerte e o modal nao', () => {
    const { container } = render(<Tela aberto />);

    const modal = screen.getByRole('dialog');
    expect(container.hasAttribute('inert')).toBe(true);
    expect(modal.hasAttribute('inert')).toBe(false);
    expect(document.activeElement).toBe(campo());
  });

  it('ao sair, solta o fundo e devolve o foco a quem estava focado quando abriu', () => {
    const { container, rerender } = render(<Tela aberto={false} />);
    encerrar().focus();
    rerender(<Tela aberto />);
    expect(document.activeElement).toBe(campo());

    fechaESai(rerender, <Tela aberto={false} />);

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(container.hasAttribute('inert')).toBe(false);
    expect(document.activeElement).toBe(encerrar());
  });

  it('com destino, o foco vai para ele, lido na hora da saida', () => {
    // O botao que disparou a acao ficou desabilitado e perdeu o foco: quando
    // o modal abre, o foco esta no <body>.
    const { rerender } = render(<Tela aberto={false} />);
    let destino: HTMLElement | null = null;
    const devolverFoco = () => destino;
    rerender(<Tela aberto devolverFoco={devolverFoco} />);

    // Enquanto o modal esta aberto, o destino muda (a linha sai da lista).
    destino = encerrar();
    fechaESai(rerender, <Tela aberto={false} devolverFoco={devolverFoco} />);

    expect(document.activeElement).toBe(encerrar());
  });

  it('sem destino e sem nada focado ao abrir, sai sem lancar e sem prender nada', () => {
    const { container, rerender } = render(<Tela aberto={false} />);
    rerender(<Tela aberto devolverFoco={() => null} />);

    expect(() => fechaESai(rerender, <Tela aberto={false} />)).not.toThrow();
    expect(container.hasAttribute('inert')).toBe(false);
  });
});
