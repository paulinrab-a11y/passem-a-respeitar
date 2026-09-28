// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EstadoNome } from './estado';

vi.mock('./acoes', () => ({
  salvarNome: vi.fn(
    async (anterior: EstadoNome): Promise<EstadoNome> => ({
      recado: { tom: 'erro', texto: 'Não consegui salvar agora.' },
      tentativa: anterior.tentativa + 1,
    })
  ),
}));

import NomeForm from './NomeForm';

const campo = () => screen.getByLabelText('Nome') as HTMLInputElement;

afterEach(cleanup);

describe('nome da conta (#130)', () => {
  it('comeca com o nome salvo', () => {
    render(<NomeForm nome="Maria" />);

    expect(campo().value).toBe('Maria');
  });

  it('erro ao salvar mantem o que foi digitado, e nao volta ao nome antigo', async () => {
    const { container } = render(<NomeForm nome="Maria" />);

    fireEvent.change(campo(), { target: { value: 'Maria Teste' } });

    await act(async () => {
      fireEvent.submit(container.querySelector('form') as HTMLFormElement);
    });
    await screen.findByRole('status');

    expect(campo().value).toBe('Maria Teste');
  });
});
