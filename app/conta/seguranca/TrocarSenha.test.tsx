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
  await screen.findByRole('status');
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
