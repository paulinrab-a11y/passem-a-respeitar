// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TEMPO_NA_TELA } from '@/app/_ui/saida-automatica';
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

describe('toast da troca de senha (#136)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const passa = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

  // Sem o `findByRole` do bloco de cima: ele espera com o relogio, e o
  // relogio aqui esta parado. O `act` assincrono ja resolve a acao.
  async function preencheEEnvia(container: HTMLElement) {
    fireEvent.change(campo('Senha atual'), { target: { value: 'senha-antiga-1' } });
    fireEvent.change(campo('Nova senha'), { target: { value: 'senha-nova-longa-2' } });
    fireEvent.change(campo('Confirmar nova senha'), { target: { value: 'senha-nova-longa-2' } });

    await act(async () => {
      fireEvent.submit(container.querySelector('form') as HTMLFormElement);
    });
    expect(screen.getByRole('status').textContent).toContain('Senha atual incorreta.');
  }

  // Antes o erro so saia no "x" e ficava em cima do fim da pagina.
  it('o erro sai sozinho, sem ninguem clicar no "x"', async () => {
    const { container } = render(<TrocarSenha />);
    await preencheEEnvia(container);

    passa(TEMPO_NA_TELA.erro - 1);
    expect(screen.queryByRole('status')).not.toBeNull();

    // O prazo de tela e depois o do desmonte animado.
    passa(1 + 400);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('o erro nao sai com o ponteiro em cima', async () => {
    const { container } = render(<TrocarSenha />);
    await preencheEEnvia(container);

    act(() => void fireEvent.mouseEnter(screen.getByRole('status')));
    passa(TEMPO_NA_TELA.erro * 3);

    expect(screen.queryByRole('status')).not.toBeNull();
  });

  it('o erro sair nao apaga o que foi digitado', async () => {
    const { container } = render(<TrocarSenha />);
    await preencheEEnvia(container);

    passa(TEMPO_NA_TELA.erro + 400);

    expect(campo('Senha atual').value).toBe('senha-antiga-1');
    expect(campo('Nova senha').value).toBe('senha-nova-longa-2');
  });
});
