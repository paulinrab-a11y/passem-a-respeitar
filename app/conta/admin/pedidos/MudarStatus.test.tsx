// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EstadoAdmin } from './estado';

const PEDIDO = '11111111-1111-4111-8111-111111111111';
const resposta = vi.hoisted(() => ({
  tom: 'erro' as 'ok' | 'erro',
  /** A acao do botao pede a senha (#351). */
  pedeSenha: false,
}));

const acoes = vi.hoisted(() => ({
  mudarStatus: vi.fn(
    async (): Promise<EstadoAdmin> =>
      resposta.pedeSenha
        ? {
            recado: null,
            pedido: '11111111-1111-4111-8111-111111111111',
            precisaReautenticar: { minutos: 15 },
          }
        : {
            recado: {
              tom: resposta.tom,
              texto: resposta.tom === 'ok' ? 'Feito.' : 'Não deu agora.',
            },
            pedido: '11111111-1111-4111-8111-111111111111',
          }
  ),
  reautenticarEMudar: vi.fn(
    async (_anterior: EstadoAdmin, _form: FormData): Promise<EstadoAdmin> => ({
      recado: { tom: 'ok', texto: 'Estornado no Mercado Pago. Status atualizado.' },
      pedido: '11111111-1111-4111-8111-111111111111',
    })
  ),
}));

vi.mock('./acoes', () => acoes);

import MudarStatus from './MudarStatus';

const motivo = () => screen.getByLabelText('Motivo (opcional)') as HTMLInputElement;

async function escreveEEnvia(container: HTMLElement) {
  fireEvent.change(motivo(), { target: { value: 'cliente pediu por e-mail' } });

  await act(async () => {
    fireEvent.submit(container.querySelector('form') as HTMLFormElement);
  });
  await screen.findByRole('alert');
}

beforeEach(() => {
  resposta.tom = 'erro';
  resposta.pedeSenha = false;
  vi.clearAllMocks();
});

afterEach(cleanup);

describe('admin de pedidos (#130)', () => {
  it('erro mantem o motivo digitado', async () => {
    const { container } = render(<MudarStatus pedido={PEDIDO} status="pago" />);

    await escreveEEnvia(container);

    expect(motivo().value).toBe('cliente pediu por e-mail');
  });

  it('sucesso esvazia o motivo, para ele nao valer para a proxima etapa', async () => {
    resposta.tom = 'ok';
    const { container } = render(<MudarStatus pedido={PEDIDO} status="pago" />);

    await escreveEEnvia(container);

    expect(motivo().value).toBe('');
  });
});

/**
 * O botao diz o que faz com o dinheiro (#22): reembolsar estorna no provedor
 * antes de mudar o status; cancelar nao devolve nada. A nota e por etapa, e
 * so onde reembolsar e uma opcao.
 */
describe('nota do reembolso (#22)', () => {
  const nota = () => document.querySelector('.admin-nota');

  it('com reembolsar e cancelar na mesma etapa, explica os dois', () => {
    render(<MudarStatus pedido={PEDIDO} status="pago" />);

    expect(screen.getByRole('button', { name: 'Reembolsar' })).toBeTruthy();
    expect(nota()?.textContent).toBe(
      'Reembolsar estorna o pagamento no Mercado Pago e só então muda o status. Cancelar não devolve o dinheiro.'
    );
  });

  it('depois de enviado so ha reembolsar, e a nota so fala dele', () => {
    render(<MudarStatus pedido={PEDIDO} status="enviado" />);

    expect(screen.queryByRole('button', { name: 'Cancelar' })).toBeNull();
    expect(nota()?.textContent).toBe(
      'Reembolsar estorna o pagamento no Mercado Pago e só então muda o status.'
    );
  });

  it('esperando pagamento nao ha o que estornar, e nao ha nota', () => {
    render(<MudarStatus pedido={PEDIDO} status="aguardando_pagamento" />);

    expect(nota()).toBeNull();
  });
});

/**
 * Reembolsar e cancelar pedem a senha quando o login nao e recente (#351).
 * O modal e o da #40, e a mudanca refeita e a mesma: botao, pedido e motivo.
 */
describe('reautenticacao do reembolso (#351)', () => {
  it('pede a senha e refaz a mesma mudanca, com o motivo digitado', async () => {
    resposta.pedeSenha = true;
    render(<MudarStatus pedido={PEDIDO} status="pago" />);

    fireEvent.change(motivo(), { target: { value: 'cliente desistiu' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Reembolsar' }));
    });

    await screen.findByRole('dialog');
    fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'senha-certa' } });
    await act(async () => {
      fireEvent.submit(screen.getByLabelText('Senha').closest('form') as HTMLFormElement);
    });

    await screen.findByText('Estornado no Mercado Pago. Status atualizado.');
    const enviado = acoes.reautenticarEMudar.mock.calls[0][1];
    expect(enviado.get('pedido')).toBe(PEDIDO);
    expect(enviado.get('para')).toBe('reembolsado');
    expect(enviado.get('motivo')).toBe('cliente desistiu');
    expect(enviado.get('senha')).toBe('senha-certa');
  });

  it('sem pedido de senha, o modal nao aparece', async () => {
    const { container } = render(<MudarStatus pedido={PEDIDO} status="pago" />);

    await escreveEEnvia(container);

    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
