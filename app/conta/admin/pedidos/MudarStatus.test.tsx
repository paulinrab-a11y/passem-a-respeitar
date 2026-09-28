// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EstadoAdmin } from './estado';

const PEDIDO = '11111111-1111-4111-8111-111111111111';
const resposta = vi.hoisted(() => ({ tom: 'erro' as 'ok' | 'erro' }));

vi.mock('./acoes', () => ({
  mudarStatus: vi.fn(
    async (): Promise<EstadoAdmin> => ({
      recado: { tom: resposta.tom, texto: resposta.tom === 'ok' ? 'Feito.' : 'Não deu agora.' },
      pedido: '11111111-1111-4111-8111-111111111111',
    })
  ),
}));

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
