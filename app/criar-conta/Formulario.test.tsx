// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EstadoCriarConta } from './estado';

let resposta: 'erro' | 'enviado' = 'erro';
vi.mock('./acoes', () => ({
  criarConta: vi.fn(
    async (anterior: EstadoCriarConta): Promise<EstadoCriarConta> =>
      resposta === 'enviado'
        ? {
            erro: null,
            campo: null,
            enviadoPara: 'maria@exemplo.com',
            tentativa: anterior.tentativa + 1,
          }
        : {
            ...anterior,
            erro: 'A confirmação não bate com a senha.',
            campo: 'confirmacao',
            tentativa: anterior.tentativa + 1,
          }
  ),
  confirmarCodigo: vi.fn(),
  reenviarCodigo: vi.fn(),
}));

import Formulario from './Formulario';

const campo = (rotulo: string | RegExp) => screen.getByLabelText(rotulo) as HTMLInputElement;

afterEach(cleanup);

describe('cadastro (#130)', () => {
  it('errar a confirmacao mantem e-mail e o aceite marcado', async () => {
    const { container } = render(<Formulario />);

    fireEvent.change(campo('E-mail'), { target: { value: 'maria@exemplo.com' } });
    fireEvent.change(campo('Senha'), { target: { value: 'senha-longa-de-teste' } });
    fireEvent.change(campo('Confirme a senha'), { target: { value: 'outra-coisa' } });
    fireEvent.click(campo(/Li e aceito/));

    await act(async () => {
      fireEvent.submit(container.querySelector('form') as HTMLFormElement);
    });
    await screen.findByRole('alert');

    expect(campo('E-mail').value).toBe('maria@exemplo.com');
    expect(campo(/Li e aceito/).checked).toBe(true);
  });
});

describe('cadastro curto (#207)', () => {
  it('pede e-mail, senha, confirmacao e aceite, e nao pede nome', () => {
    render(<Formulario />);

    expect(screen.queryByLabelText('Como quer ser chamado')).toBeNull();
    expect(campo('E-mail')).toBeTruthy();
    expect(campo('Senha')).toBeTruthy();
    expect(campo('Confirme a senha')).toBeTruthy();
    expect(campo(/Li e aceito/)).toBeTruthy();
    // Nenhum campo chamado nome, nem escondido.
    expect(document.querySelector('[name="nome"]')).toBeNull();
  });
});

describe('tela do codigo (#224)', () => {
  it('depois do envio aparece a tela do codigo; trocar e-mail volta com os campos', async () => {
    resposta = 'enviado';
    const { container } = render(<Formulario />);

    fireEvent.change(campo('E-mail'), { target: { value: 'maria@exemplo.com' } });
    fireEvent.change(campo('Senha'), { target: { value: 'senha-longa-de-teste' } });
    fireEvent.change(campo('Confirme a senha'), { target: { value: 'senha-longa-de-teste' } });
    fireEvent.click(campo(/Li e aceito/));
    await act(async () => {
      fireEvent.submit(container.querySelector('form') as HTMLFormElement);
    });

    expect(await screen.findByLabelText(/Código de 8 dígitos/)).toBeTruthy();
    expect(screen.getByText('maria@exemplo.com')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Trocar e-mail' }));

    expect(campo('E-mail').value).toBe('maria@exemplo.com');
    expect(campo(/Li e aceito/).checked).toBe(true);
    resposta = 'erro';
  });
});
