// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EstadoSenha } from './estado';

const resposta = vi.hoisted(() => ({ tom: 'erro' as 'ok' | 'erro' }));

vi.mock('./acoes', () => ({
  trocarSenha: vi.fn(
    async (anterior: EstadoSenha): Promise<EstadoSenha> => ({
      recado: {
        tom: resposta.tom,
        texto: resposta.tom === 'ok' ? 'Senha trocada.' : 'Senha atual incorreta.',
      },
      campo: resposta.tom === 'ok' ? null : 'atual',
      tentativa: anterior.tentativa + 1,
    })
  ),
}));

import TrocarSenha from './TrocarSenha';

const campo = (rotulo: string) => screen.getByLabelText(rotulo) as HTMLInputElement;

async function preencheEEnvia(container: HTMLElement) {
  fireEvent.change(campo('Senha atual'), { target: { value: 'senha-antiga-1' } });
  fireEvent.change(campo('Nova senha'), { target: { value: 'senha-nova-longa-2' } });
  fireEvent.change(campo('Confirmar nova senha'), { target: { value: 'senha-nova-longa-2' } });

  await act(async () => {
    fireEvent.submit(container.querySelector('form') as HTMLFormElement);
  });
  // Erro interrompe (`alert`); sucesso espera a vez (`status`). (#51)
  await screen.findByRole(resposta.tom === 'ok' ? 'status' : 'alert');
}

beforeEach(() => {
  resposta.tom = 'erro';
});

afterEach(cleanup);

describe('troca de senha (#130)', () => {
  it('erro mantem os tres campos, sem nada vir do servidor', async () => {
    const { container } = render(<TrocarSenha />);

    await preencheEEnvia(container);

    expect(campo('Senha atual').value).toBe('senha-antiga-1');
    expect(campo('Nova senha').value).toBe('senha-nova-longa-2');
    expect(campo('Confirmar nova senha').value).toBe('senha-nova-longa-2');
  });

  it('sucesso esvazia os tres: senha trocada nao fica parada na tela', async () => {
    resposta.tom = 'ok';
    const { container } = render(<TrocarSenha />);

    await preencheEEnvia(container);

    expect(campo('Senha atual').value).toBe('');
    expect(campo('Nova senha').value).toBe('');
    expect(campo('Confirmar nova senha').value).toBe('');
  });
});

describe('troca de senha (#51)', () => {
  it('erro marca o campo que errou, liga ao aviso e leva o foco ate ele', async () => {
    const { container } = render(<TrocarSenha />);

    await preencheEEnvia(container);
    const aviso = await screen.findByRole('alert');

    expect(campo('Senha atual').getAttribute('aria-invalid')).toBe('true');
    expect(campo('Senha atual').getAttribute('aria-describedby')).toBe(aviso.id);
    expect(document.activeElement).toBe(campo('Senha atual'));
    // Os outros dois nao erraram.
    expect(campo('Nova senha').hasAttribute('aria-invalid')).toBe(false);
    expect(campo('Confirmar nova senha').hasAttribute('aria-invalid')).toBe(false);
  });

  it('o medidor de senha continua descrevendo o campo, com ou sem erro', () => {
    render(<TrocarSenha />);

    expect(campo('Nova senha').getAttribute('aria-describedby')).toBe('forca-da-senha');
  });

  it('sucesso e aviso que espera a vez, nao alerta', async () => {
    resposta.tom = 'ok';
    const { container } = render(<TrocarSenha />);

    fireEvent.change(campo('Senha atual'), { target: { value: 'senha-antiga-1' } });
    await act(async () => {
      fireEvent.submit(container.querySelector('form') as HTMLFormElement);
    });

    expect((await screen.findByRole('status')).id).toBe('aviso-da-senha');
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
