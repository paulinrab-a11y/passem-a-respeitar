// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EstadoEntrar } from './estado';

vi.mock('./acoes', () => ({
  entrar: vi.fn(
    async (anterior: EstadoEntrar): Promise<EstadoEntrar> => ({
      erro: 'E-mail ou senha incorretos.',
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
