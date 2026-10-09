// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EstadoCodigo } from '@/app/_ui/estado-do-codigo';
import type { EstadoCriarConta } from './estado';

let resposta: 'erro' | 'enviado' = 'erro';
let codigosRecebidos: FormData[] = [];
const confirmarCadastro = vi.fn(async (anterior: EstadoCodigo, form: FormData) => {
  codigosRecebidos.push(form);
  return { erro: 'Código inválido.', tentativa: anterior.tentativa + 1 };
});
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
  confirmarCadastro: (...a: [EstadoCodigo, FormData]) => confirmarCadastro(...a),
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

describe('quem criou a conta e nao confirmou (#260)', () => {
  // Quem saiu da tela do codigo volta pelo login com a senha: o caminho mais
  // curto. Aparece para todo mundo, entao nao conta quem tem cadastro.
  it('o rodape aponta o login com a senha que a pessoa escolheu', () => {
    render(<Formulario />);

    const dica = screen.getByText(
      'Criou a conta e não confirmou o e-mail? Entre com a senha que escolheu: mandamos um código novo.'
    );
    expect(dica.className).toBe('auth-rodape');
    expect(screen.getByRole('link', { name: 'Entrar' }).getAttribute('href')).toBe('/entrar');
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

/**
 * A senha digitada no cadastro e a que o codigo grava (#284): vai do estado
 * do formulario para o envio do codigo, sem passar por campo da pagina.
 */
describe('a senha do cadastro vai com o codigo (#284)', () => {
  it('o codigo leva a senha que a pessoa digitou no formulario', async () => {
    resposta = 'enviado';
    codigosRecebidos = [];
    // requestSubmit nao existe no jsdom: vira um submit normal do formulario.
    HTMLFormElement.prototype.requestSubmit ??= function () {
      this.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    };
    const { container } = render(<Formulario />);

    fireEvent.change(campo('E-mail'), { target: { value: 'maria@exemplo.com' } });
    fireEvent.change(campo('Senha'), { target: { value: 'senha-longa-de-teste' } });
    fireEvent.change(campo('Confirme a senha'), { target: { value: 'senha-longa-de-teste' } });
    fireEvent.click(campo(/Li e aceito/));
    await act(async () => {
      fireEvent.submit(container.querySelector('form') as HTMLFormElement);
    });

    const codigo = await screen.findByLabelText(/Código de 8 dígitos/);
    // Na tela do codigo, a senha so existe na memoria do formulario.
    expect(container.innerHTML).not.toContain('senha-longa-de-teste');

    await act(async () => {
      fireEvent.change(codigo, { target: { value: '12345678' } });
    });
    await screen.findByRole('alert');

    expect(Object.fromEntries(codigosRecebidos[0])).toMatchObject({
      email: 'maria@exemplo.com',
      codigo: '12345678',
      senha: 'senha-longa-de-teste',
      confirmacao: 'senha-longa-de-teste',
    });
    resposta = 'erro';
  });
});
