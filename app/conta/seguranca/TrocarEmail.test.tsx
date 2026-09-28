// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EstadoCancelamento, EstadoEmail } from './estado-email';

const resposta = vi.hoisted(() => ({ tom: 'erro' as 'ok' | 'erro' }));

vi.mock('./email', () => ({
  trocarEmail: vi.fn(
    async (anterior: EstadoEmail): Promise<EstadoEmail> => ({
      recado: {
        tom: resposta.tom,
        texto: resposta.tom === 'ok' ? 'Mandamos dois links.' : 'A senha está incorreta.',
      },
      campo: resposta.tom === 'ok' ? null : 'senha',
      tentativa: anterior.tentativa + 1,
    })
  ),
  cancelarTrocaDeEmail: vi.fn(
    async (): Promise<EstadoCancelamento> => ({
      recado: { tom: 'ok', texto: 'Troca cancelada.' },
    })
  ),
}));

import TrocarEmail from './TrocarEmail';

const ATUAL = 'pessoa@exemplo.invalid';
const campo = (rotulo: string) => screen.getByLabelText(rotulo) as HTMLInputElement;

async function preencheEEnvia(container: HTMLElement) {
  fireEvent.change(campo('Novo e-mail'), { target: { value: 'nova@exemplo.invalid' } });
  fireEvent.change(campo('Sua senha, para confirmar'), { target: { value: 'uma-senha' } });

  await act(async () => {
    fireEvent.submit(container.querySelector('form') as HTMLFormElement);
  });
}

beforeEach(() => {
  resposta.tom = 'erro';
});

afterEach(cleanup);

describe('sem troca pendente', () => {
  it('mostra o e-mail atual e o formulario', () => {
    render(<TrocarEmail atual={ATUAL} pendente={null} />);

    expect(screen.getByText(ATUAL)).toBeTruthy();
    expect(campo('Novo e-mail').value).toBe('');
    expect(screen.queryByText('Cancelar a troca')).toBeNull();
  });

  it('erro mantem os dois campos e marca o que errou (#130)', async () => {
    const { container } = render(<TrocarEmail atual={ATUAL} pendente={null} />);

    await preencheEEnvia(container);
    await screen.findByRole('alert');

    expect(campo('Novo e-mail').value).toBe('nova@exemplo.invalid');
    expect(campo('Sua senha, para confirmar').value).toBe('uma-senha');
    expect(campo('Sua senha, para confirmar').getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(campo('Sua senha, para confirmar'));
  });

  it('pedido aceito esvazia os campos: a senha nao fica parada na tela', async () => {
    resposta.tom = 'ok';
    const { container } = render(<TrocarEmail atual={ATUAL} pendente={null} />);

    await preencheEEnvia(container);
    await screen.findByText('Mandamos dois links.');

    expect(campo('Novo e-mail').value).toBe('');
    expect(campo('Sua senha, para confirmar').value).toBe('');
  });
});

describe('com troca pendente', () => {
  it('mostra para onde, explica as duas confirmacoes e esconde o formulario', () => {
    render(<TrocarEmail atual={ATUAL} pendente="nova@exemplo.invalid" />);

    expect(screen.getByText('nova@exemplo.invalid')).toBeTruthy();
    expect(screen.getByText(/os dois forem\s+confirmados/)).toBeTruthy();
    expect(screen.queryByLabelText('Novo e-mail')).toBeNull();
  });

  it('cancelar mostra o recado do cancelamento', async () => {
    const { container } = render(<TrocarEmail atual={ATUAL} pendente="nova@exemplo.invalid" />);

    await act(async () => {
      fireEvent.submit(container.querySelector('form') as HTMLFormElement);
    });

    expect((await screen.findByText('Troca cancelada.')).getAttribute('role')).toBe('status');
  });
});

describe('recado do pedido', () => {
  it('some quando a troca pendente ja esta na tela, para nao dizer a mesma coisa duas vezes', async () => {
    resposta.tom = 'ok';
    const { container, rerender } = render(<TrocarEmail atual={ATUAL} pendente={null} />);

    await preencheEEnvia(container);
    await screen.findByText('Mandamos dois links.');

    // O servidor revalida a pagina e passa a mandar o endereco pendente.
    rerender(<TrocarEmail atual={ATUAL} pendente="nova@exemplo.invalid" />);

    expect(screen.queryByText('Mandamos dois links.')).toBeNull();
    expect(screen.getByText('Cancelar a troca')).toBeTruthy();
  });
});
