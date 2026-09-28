// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fimDaAnimacao } from '@/app/_ui/fim-da-animacao';
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

    // Os dois saem com fade (#155): o formulario e o recado dele.
    const form = container.querySelector('form') as HTMLFormElement;
    const recado = screen.getByText('Mandamos dois links.');
    expect(form.className).toContain('saindo');
    expect(recado.className).toContain('saindo');

    fimDaAnimacao(form);
    fimDaAnimacao(recado);

    expect(screen.queryByText('Mandamos dois links.')).toBeNull();
    expect(screen.getByText('Cancelar a troca')).toBeTruthy();
  });
});

describe('troca entre formulario e troca pendente (#155)', () => {
  it('na carga da pagina o formulario nao tem entrada propria nem saida', () => {
    const { container } = render(<TrocarEmail atual={ATUAL} pendente={null} />);

    expect(container.querySelector('form')?.className).toBe('conta-bloco troca-email-form');
  });

  it('o formulario sai antes de a troca pendente entrar', () => {
    const { container, rerender } = render(<TrocarEmail atual={ATUAL} pendente={null} />);

    rerender(<TrocarEmail atual={ATUAL} pendente="nova@exemplo.invalid" />);

    const form = container.querySelector('form') as HTMLFormElement;
    expect(form.className).toBe('conta-bloco troca-email-form saindo');
    expect(container.querySelector('.troca-email-pendente')).toBeNull();

    fimDaAnimacao(form);

    expect(screen.queryByLabelText('Novo e-mail')).toBeNull();
    expect(container.querySelector('.troca-email-pendente')?.className).toBe(
      'troca-email-pendente'
    );
  });

  it('a troca pendente sai dizendo para onde era, e o formulario volta com entrada', () => {
    const { container, rerender } = render(
      <TrocarEmail atual={ATUAL} pendente="nova@exemplo.invalid" />
    );

    // Cancelou: o servidor revalida e a prop vira null na hora.
    rerender(<TrocarEmail atual={ATUAL} pendente={null} />);

    const bloco = container.querySelector('.troca-email-pendente') as HTMLElement;
    expect(bloco.className).toBe('troca-email-pendente saindo');
    expect(bloco.textContent).toContain('nova@exemplo.invalid');
    expect(screen.queryByLabelText('Novo e-mail')).toBeNull();

    fimDaAnimacao(bloco);

    expect(container.querySelector('.troca-email-pendente')).toBeNull();
    expect((screen.getByLabelText('Novo e-mail').closest('form') as HTMLElement).className).toBe(
      'conta-bloco troca-email-form entrou'
    );
  });

  it('o fim da animacao do botao nao encerra a saida do bloco', () => {
    const { container, rerender } = render(
      <TrocarEmail atual={ATUAL} pendente="nova@exemplo.invalid" />
    );
    rerender(<TrocarEmail atual={ATUAL} pendente={null} />);

    fimDaAnimacao(container.querySelector('.troca-email-pendente button') as HTMLElement);

    expect(container.querySelector('.troca-email-pendente')).not.toBeNull();
  });
});

describe('recado do pedido depois que a troca pendente sai (#155)', () => {
  async function pedeEMostraPendente() {
    resposta.tom = 'ok';
    const tela = render(<TrocarEmail atual={ATUAL} pendente={null} />);

    await preencheEEnvia(tela.container);
    tela.rerender(<TrocarEmail atual={ATUAL} pendente="nova@exemplo.invalid" />);
    fimDaAnimacao(tela.container.querySelector('form') as HTMLFormElement);
    fimDaAnimacao(screen.getByText('Mandamos dois links.'));
    expect(screen.queryByText('Mandamos dois links.')).toBeNull();

    return tela;
  }

  // O recado do pedido continuava guardado, e sem a troca pendente na tela
  // nada mais o escondia: ele entrava, falando de links que nao valem mais.
  it('a pagina revalida sem pendente: o recado do pedido nao volta', async () => {
    const { rerender } = await pedeEMostraPendente();

    rerender(<TrocarEmail atual={ATUAL} pendente={null} />);

    expect(screen.queryByText('Mandamos dois links.')).toBeNull();
  });

  it('quem cancela ve o recado do cancelamento, e so ele', async () => {
    const { container, rerender } = await pedeEMostraPendente();

    await act(async () => {
      fireEvent.submit(container.querySelector('form') as HTMLFormElement);
    });
    rerender(<TrocarEmail atual={ATUAL} pendente={null} />);

    expect(screen.queryByText('Mandamos dois links.')).toBeNull();
    expect(screen.getByText('Troca cancelada.')).toBeTruthy();
  });
});
