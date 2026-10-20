// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EstadoCriarSenha, EstadoEnvioDaSenha } from './estado-criar-senha';

const resposta = vi.hoisted(() => ({ criada: false }));
const recebido = vi.hoisted(() => ({ envio: null as FormData | null }));

vi.mock('./criar-senha', () => ({
  pedirCodigoDaSenha: vi.fn(
    async (anterior: EstadoEnvioDaSenha, form: FormData): Promise<EstadoEnvioDaSenha> => {
      recebido.envio = form;
      return {
        recado: { tom: 'ok', texto: 'Enviamos um código.' },
        enviadoEm: Date.now(),
        tentativa: anterior.tentativa + 1,
      };
    }
  ),
  criarSenha: vi.fn(
    async (anterior: EstadoCriarSenha): Promise<EstadoCriarSenha> =>
      resposta.criada
        ? {
            recado: { tom: 'ok', texto: 'Senha criada.' },
            campo: null,
            tentativa: anterior.tentativa + 1,
            criada: true,
          }
        : {
            recado: { tom: 'erro', texto: 'Código inválido ou vencido.' },
            campo: 'codigo',
            tentativa: anterior.tentativa + 1,
          }
  ),
}));
vi.mock('./acoes', () => ({ trocarSenha: vi.fn() }));

import Senha from './Senha';

const campo = (rotulo: string) => screen.getByLabelText(rotulo) as HTMLInputElement;

beforeEach(() => {
  resposta.criada = false;
  recebido.envio = null;
});

afterEach(cleanup);

async function preencheECria() {
  fireEvent.change(campo('Código do e-mail'), { target: { value: '12345678' } });
  fireEvent.change(campo('Nova senha'), { target: { value: 'senha-nova-longa-2' } });
  fireEvent.change(campo('Confirmar nova senha'), { target: { value: 'senha-nova-longa-2' } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Criar senha' }));
  });
}

describe('bloco de senha de Seguranca (#389)', () => {
  it('conta com senha: "Trocar senha" com a senha atual, sem codigo', () => {
    render(<Senha semSenha={false} />);
    expect(screen.getByText('Trocar senha', { selector: 'p' })).toBeTruthy();
    expect(campo('Senha atual')).toBeTruthy();
    expect(screen.queryByLabelText('Código do e-mail')).toBeNull();
  });

  it('conta sem senha: "Criar senha" com o codigo no lugar da senha atual', () => {
    render(<Senha semSenha />);
    expect(screen.getByText('Criar senha', { selector: 'p' })).toBeTruthy();
    expect(screen.queryByLabelText('Senha atual')).toBeNull();
    expect(campo('Código do e-mail').autocomplete).toBe('one-time-code');
    expect(campo('Nova senha').type).toBe('password');
  });

  it('o nome do botao do codigo nao entra no nome do campo', () => {
    render(<Senha semSenha />);
    expect(screen.getByRole('textbox', { name: 'Código do e-mail' })).toBeTruthy();
  });

  it('o campo do codigo so guarda digitos, ate 8', () => {
    render(<Senha semSenha />);
    fireEvent.change(campo('Código do e-mail'), { target: { value: 'Seu código: 1234 56789' } });
    expect(campo('Código do e-mail').value).toBe('12345678');
  });

  it('pedir o codigo nao leva a senha digitada junto', async () => {
    render(<Senha semSenha />);
    fireEvent.change(campo('Nova senha'), { target: { value: 'senha-nova-longa-2' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Enviar código' }));
    });

    expect(recebido.envio).not.toBeNull();
    expect(recebido.envio?.has('nova')).toBe(false);
    expect(recebido.envio?.has('confirmacao')).toBe(false);
    expect((await screen.findByRole('status')).textContent).toMatch(/Enviamos um código/);
    // A espera do reenvio comecou, e o foco foi para o campo do codigo.
    const botao = screen.getByRole('button', { name: /Reenviar código em \d+ segundos/ });
    expect((botao as HTMLButtonElement).disabled).toBe(true);
    expect(document.activeElement).toBe(campo('Código do e-mail'));
  });

  it('codigo errado: aviso de erro, campo do codigo limpo e com o foco', async () => {
    render(<Senha semSenha />);
    await preencheECria();

    expect((await screen.findByRole('alert')).textContent).toMatch(/inválido ou vencido/);
    expect(campo('Código do e-mail').value).toBe('');
    expect(campo('Código do e-mail').getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(campo('Código do e-mail'));
    // A senha digitada fica: o erro e do codigo.
    expect(campo('Nova senha').value).toBe('senha-nova-longa-2');
  });

  it('senha criada: a tela vira "Trocar senha" e o aviso fica', async () => {
    resposta.criada = true;
    render(<Senha semSenha />);
    await preencheECria();

    expect((await screen.findByRole('status')).textContent).toMatch(/Senha criada/);
    expect(screen.getByText('Trocar senha', { selector: 'p' })).toBeTruthy();
    expect(campo('Senha atual')).toBeTruthy();
    expect(screen.queryByLabelText('Código do e-mail')).toBeNull();
  });
});
