// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EstadoEntrar } from './estado';

vi.mock('./acoes', () => ({
  entrar: vi.fn(
    async (anterior: EstadoEntrar): Promise<EstadoEntrar> => ({
      erro: 'E-mail ou senha incorretos.',
      campo: 'credenciais',
      tentativa: anterior.tentativa + 1,
    })
  ),
}));

import Formulario from './Formulario';

const campo = (rotulo: string) => screen.getByLabelText(rotulo) as HTMLInputElement;

afterEach(cleanup);

describe('login (#130)', () => {
  it('errar a senha mantem o e-mail e a caixinha de manter conectado', async () => {
    const { container } = render(<Formulario next="/conta" />);

    fireEvent.change(campo('E-mail'), { target: { value: 'maria@exemplo.com' } });
    fireEvent.change(campo('Senha'), { target: { value: 'senha-errada' } });
    fireEvent.click(campo('Manter conectado'));

    await act(async () => {
      fireEvent.submit(container.querySelector('form') as HTMLFormElement);
    });
    await screen.findByRole('alert');

    expect(campo('E-mail').value).toBe('maria@exemplo.com');
    expect(campo('Manter conectado').checked).toBe(true);
  });
});

describe('login (#51)', () => {
  it('erro de credencial marca e-mail e senha juntos, e liga os dois a mensagem', async () => {
    const { container } = render(<Formulario next="/conta" />);

    expect(campo('E-mail').hasAttribute('aria-invalid')).toBe(false);
    expect(campo('E-mail').hasAttribute('aria-describedby')).toBe(false);

    fireEvent.change(campo('E-mail'), { target: { value: 'maria@exemplo.com' } });
    fireEvent.change(campo('Senha'), { target: { value: 'senha-errada' } });
    await act(async () => {
      fireEvent.submit(container.querySelector('form') as HTMLFormElement);
    });
    const erro = await screen.findByRole('alert');

    for (const rotulo of ['E-mail', 'Senha']) {
      expect(campo(rotulo).getAttribute('aria-invalid')).toBe('true');
      expect(campo(rotulo).getAttribute('aria-describedby')).toBe(erro.id);
    }
    // O erro entra dentro do lugar que ja estava reservado.
    expect(erro.parentElement?.className).toBe('erro-vaga');
  });

  it('o lugar do erro existe antes de qualquer erro', () => {
    const { container } = render(<Formulario next="/conta" />);
    const vaga = container.querySelector('.erro-vaga');

    expect(vaga).not.toBeNull();
    expect(vaga?.children).toHaveLength(0);
    // Entre o ultimo campo e o botao, onde o erro aparece.
    expect(vaga?.nextElementSibling?.tagName).toBe('BUTTON');
  });
});
