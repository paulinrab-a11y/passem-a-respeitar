// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EstadoCriarConta } from './estado';

vi.mock('./acoes', () => ({
  criarConta: vi.fn(
    async (anterior: EstadoCriarConta): Promise<EstadoCriarConta> => ({
      ...anterior,
      erro: 'A confirmação não bate com a senha.',
      campo: 'confirmacao',
      tentativa: anterior.tentativa + 1,
    })
  ),
}));

import Formulario from './Formulario';

const campo = (rotulo: string | RegExp) => screen.getByLabelText(rotulo) as HTMLInputElement;

afterEach(cleanup);

describe('cadastro (#130)', () => {
  it('errar a confirmacao mantem nome, e-mail e o aceite marcado', async () => {
    const { container } = render(<Formulario />);

    fireEvent.change(campo('Como quer ser chamado'), { target: { value: 'Maria' } });
    fireEvent.change(campo('E-mail'), { target: { value: 'maria@exemplo.com' } });
    fireEvent.change(campo('Senha'), { target: { value: 'senha-longa-de-teste' } });
    fireEvent.change(campo('Confirme a senha'), { target: { value: 'outra-coisa' } });
    fireEvent.click(campo(/Li e aceito/));

    await act(async () => {
      fireEvent.submit(container.querySelector('form') as HTMLFormElement);
    });
    await screen.findByRole('alert');

    expect(campo('Como quer ser chamado').value).toBe('Maria');
    expect(campo('E-mail').value).toBe('maria@exemplo.com');
    expect(campo(/Li e aceito/).checked).toBe(true);
  });
});
