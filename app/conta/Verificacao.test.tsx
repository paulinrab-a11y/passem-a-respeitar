// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./acoes', () => ({ reenviarVerificacao: vi.fn(), confirmarCodigoDaConta: vi.fn() }));

import Verificacao from './Verificacao';

afterEach(cleanup);

/**
 * O aviso da conta sem e-mail confirmado (#30, #250, #260): diz so o que o
 * site barra de verdade — comprar — e tem onde digitar o codigo que o botao
 * manda. Antes o botao mandava um codigo sem campo.
 */
describe('aviso de e-mail nao verificado', () => {
  it('diz que sem verificar nao da para comprar', () => {
    const { container } = render(<Verificacao />);

    expect(container.textContent).toContain('Sem isso, não dá para comprar.');
  });

  it('nao diz que a senha fica sem recuperacao', () => {
    const { container } = render(<Verificacao />);

    expect(container.textContent).not.toMatch(/recuperar a senha/i);
  });

  it('tem o campo do codigo e o botao de enviar, livre desde o comeco', () => {
    render(<Verificacao />);

    const campo = screen.getByLabelText(/Código de 8 dígitos/) as HTMLInputElement;
    expect(campo.getAttribute('autocomplete')).toBe('one-time-code');
    const enviar = screen.getByRole('button', { name: 'Enviar código' }) as HTMLButtonElement;
    expect(enviar.disabled).toBe(false);
  });

  // A pagina tem outras coisas: o aviso nao rouba o foco nem o teclado.
  it('nao rouba o foco da pagina', () => {
    render(<Verificacao />);

    expect(document.activeElement).not.toBe(screen.getByLabelText(/Código de 8 dígitos/));
  });

  // O e-mail vem da sessao no servidor. Um campo de e-mail aqui seria um
  // convite a mandar outro.
  it('nao manda e-mail nenhum do navegador', () => {
    const { container } = render(<Verificacao />);

    expect(container.querySelector('input[name="email"]')).toBeNull();
  });
});
