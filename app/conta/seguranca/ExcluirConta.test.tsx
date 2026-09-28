// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EstadoExclusao } from './estado-exclusao';

vi.mock('./excluir', () => ({
  excluirConta: vi.fn(
    async (): Promise<EstadoExclusao> => ({
      recado: { tom: 'erro', texto: 'Senha incorreta.' },
    })
  ),
}));

import ExcluirConta from './ExcluirConta';

const EMAIL = 'maria@exemplo.com';
const campoEmail = () =>
  screen.getByLabelText(`Digite ${EMAIL} para confirmar`) as HTMLInputElement;
const campoSenha = () => screen.getByLabelText('Sua senha') as HTMLInputElement;

function abreEPreenche() {
  fireEvent.click(screen.getByText('Quero excluir minha conta'));
  fireEvent.change(campoEmail(), { target: { value: EMAIL } });
  fireEvent.change(campoSenha(), { target: { value: 'senha-errada' } });
}

const caixinha = () =>
  screen.getByLabelText('Entendi que não dá para desfazer') as HTMLInputElement;
const botao = () =>
  screen.getByRole('button', { name: 'Excluir minha conta' }) as HTMLButtonElement;

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('excluir conta (#130)', () => {
  it('errar a senha mantem o e-mail de confirmacao', async () => {
    const { container } = render(<ExcluirConta email={EMAIL} />);
    abreEPreenche();

    await act(async () => {
      fireEvent.submit(container.querySelector('form') as HTMLFormElement);
    });
    await screen.findByRole('alert');

    expect(campoEmail().value).toBe(EMAIL);
    expect(campoSenha().value).toBe('senha-errada');
  });

  it('a caixinha e o botao continuam de acordo depois do erro', async () => {
    const { container } = render(<ExcluirConta email={EMAIL} />);
    abreEPreenche();
    fireEvent.click(caixinha());

    await act(async () => {
      fireEvent.submit(container.querySelector('form') as HTMLFormElement);
    });
    await screen.findByRole('alert');

    expect(caixinha().checked).toBe(true);
    expect(botao().disabled).toBe(false);
  });

  it('cancelar apaga o que foi digitado: reabrir comeca vazio', () => {
    vi.useFakeTimers();
    render(<ExcluirConta email={EMAIL} />);
    abreEPreenche();

    fireEvent.click(screen.getByText('Cancelar'));
    // Sem animacao no jsdom, quem desmonta e o limite de tempo do hook.
    act(() => {
      vi.advanceTimersByTime(500);
    });

    fireEvent.click(screen.getByText('Quero excluir minha conta'));

    expect(campoEmail().value).toBe('');
    expect(campoSenha().value).toBe('');
  });
});
