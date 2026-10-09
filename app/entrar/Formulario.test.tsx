// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EstadoEntrar } from './estado';

/**
 * A acao de mentira responde como a de verdade: a senha "certa-sem-confirmar"
 * e a de uma conta que nunca confirmou o e-mail (#260); o resto e credencial
 * errada.
 */
vi.mock('./acoes', () => ({
  entrar: vi.fn(async (anterior: EstadoEntrar, form: FormData): Promise<EstadoEntrar> => {
    const tentativa = anterior.tentativa + 1;
    if (form.get('senha') === 'certa-sem-confirmar') {
      return {
        erro: null,
        campo: null,
        tentativa,
        confirmar: { email: String(form.get('email')), lembrar: form.get('lembrar') === 'on' },
      };
    }
    return { erro: 'E-mail ou senha incorretos.', campo: 'credenciais', tentativa };
  }),
}));
// As acoes do codigo sao as do cadastro; aqui so importa o que a tela manda.
vi.mock('@/app/criar-conta/acoes', () => ({ confirmarCodigo: vi.fn(), reenviarCodigo: vi.fn() }));

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

describe('conta que nunca confirmou o e-mail (#260)', () => {
  async function entraSemConfirmar(container: HTMLElement, lembrar = false) {
    fireEvent.change(campo('E-mail'), { target: { value: 'maria@exemplo.com' } });
    fireEvent.change(campo('Senha'), { target: { value: 'certa-sem-confirmar' } });
    if (lembrar) fireEvent.click(campo('Manter conectado'));
    await act(async () => {
      fireEvent.submit(container.querySelector('form') as HTMLFormElement);
    });
  }

  it('a senha certa troca o formulario pela tela do codigo', async () => {
    const { container } = render(<Formulario next="/conta" />);

    await entraSemConfirmar(container);

    expect(screen.getByText('Confirme seu e-mail')).toBeTruthy();
    expect(document.getElementById('codigo-intro')?.textContent).toMatch(
      /Sua conta ainda não foi confirmada\. Enviamos um código de 8 dígitos para maria@exemplo\.com/
    );
    expect(screen.queryByLabelText('Senha')).toBeNull();
    // A tela existe para este campo: o foco ja esta nele.
    expect(document.activeElement).toBe(screen.getByLabelText(/Código de 8 dígitos/));
  });

  // O codigo termina em sessao: para onde a pessoa ia e se a sessao e para
  // durar sao decisoes do login, e vao junto.
  it('o codigo leva o e-mail, o destino e o manter conectado', async () => {
    const { container } = render(<Formulario next="/checkout?p=camiseta-cbac&tam=M" />);

    await entraSemConfirmar(container, true);

    const [codigo, reenvio] = container.querySelectorAll('form');
    for (const f of [codigo, reenvio]) {
      expect(Object.fromEntries(new FormData(f))).toMatchObject({
        email: 'maria@exemplo.com',
        next: '/checkout?p=camiseta-cbac&tam=M',
        lembrar: '1',
      });
    }
  });

  it('voltar devolve o formulario com o que ja estava digitado', async () => {
    const { container } = render(<Formulario next="/conta" />);

    await entraSemConfirmar(container, true);
    fireEvent.click(screen.getByRole('button', { name: 'Voltar' }));

    expect(campo('E-mail').value).toBe('maria@exemplo.com');
    expect(campo('Manter conectado').checked).toBe(true);
    // Voltar nao e erro: nada marcado, nada anunciado.
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('entrar de novo depois de voltar mostra a tela do codigo outra vez', async () => {
    const { container } = render(<Formulario next="/conta" />);

    await entraSemConfirmar(container);
    fireEvent.click(screen.getByRole('button', { name: 'Voltar' }));
    await act(async () => {
      fireEvent.submit(container.querySelector('form') as HTMLFormElement);
    });

    expect(screen.getByText('Confirme seu e-mail')).toBeTruthy();
  });
});
