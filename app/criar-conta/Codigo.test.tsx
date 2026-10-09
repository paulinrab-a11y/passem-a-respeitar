// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * A tela do codigo do cadastro (#224). O campo, o envio sozinho e a espera do
 * reenvio sao do `CodigoDeConfirmacao` e tem teste la; aqui fica o que e do
 * cadastro: o texto que nao conta se o e-mail tem conta, o e-mail indo junto,
 * o caminho de entrar e o de trocar o e-mail.
 */
vi.mock('./acoes', () => ({ confirmarCodigo: vi.fn(), reenviarCodigo: vi.fn() }));

import Codigo from './Codigo';

afterEach(cleanup);

describe('tela do codigo do cadastro (#224)', () => {
  it('diz "se for válido": a tela e a mesma para e-mail novo e repetido', () => {
    render(<Codigo email="maria@exemplo.com" aoTrocarEmail={() => {}} />);

    expect(screen.getByText('Confira seu e-mail')).toBeTruthy();
    expect(screen.getByText('maria@exemplo.com')).toBeTruthy();
    expect(document.getElementById('codigo-intro')?.textContent).toMatch(
      /Se maria@exemplo\.com for válido, enviamos um código de 8 dígitos/
    );
  });

  it('o e-mail vai junto no codigo e no reenvio', () => {
    const { container } = render(<Codigo email="maria@exemplo.com" aoTrocarEmail={() => {}} />);

    for (const f of container.querySelectorAll('form')) {
      expect(new FormData(f).get('email')).toBe('maria@exemplo.com');
    }
  });

  it('oferece entrar, para quem ja tinha conta com esse e-mail', () => {
    render(<Codigo email="maria@exemplo.com" aoTrocarEmail={() => {}} />);

    expect(screen.getByRole('link', { name: 'Entrar' }).getAttribute('href')).toBe('/entrar');
  });

  // A tela some ao recarregar ou fechar a aba. A volta e o login com a senha
  // (#260), e nao cadastrar de novo, que descartaria a senha nova.
  it('ensina a volta pelo login, para quem sair antes de confirmar', () => {
    render(<Codigo email="maria@exemplo.com" aoTrocarEmail={() => {}} />);

    expect(
      screen.getByText(
        'Se sair desta tela antes de confirmar, entre com a senha que escolheu: mandamos um código novo.'
      ).className
    ).toBe('auth-rodape');
  });

  it('trocar e-mail avisa o formulario', () => {
    const volta = vi.fn();
    render(<Codigo email="maria@exemplo.com" aoTrocarEmail={volta} />);

    fireEvent.click(screen.getByRole('button', { name: 'Trocar e-mail' }));

    expect(volta).toHaveBeenCalledTimes(1);
  });
});
