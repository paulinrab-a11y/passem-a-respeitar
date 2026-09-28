// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EstadoDoCheckout } from './estado';

vi.mock('./acoes', () => ({
  finalizarCompra: vi.fn(
    async (): Promise<EstadoDoCheckout> => ({
      recado: { tom: 'erro', texto: 'Confira o CEP.' },
      campo: 'cep',
    })
  ),
}));

import Entrega from './Entrega';

const ENDERECO = {
  'Quem recebe': 'Maria Teste',
  CEP: '0000',
  Rua: 'Rua das Flores',
  Número: '42',
  Complemento: 'ap 3',
  Bairro: 'Centro',
  Cidade: 'São Paulo',
  UF: 'SP',
};

const campo = (rotulo: string) => screen.getByLabelText(rotulo) as HTMLInputElement;

afterEach(cleanup);

describe('Entrega (#130)', () => {
  it('errar o CEP mantem os oito campos preenchidos', async () => {
    const { container } = render(
      <Entrega slug="camiseta-cbac" tamanho="M" quantidade={1} total="R$ 120,00" />
    );

    for (const [rotulo, valor] of Object.entries(ENDERECO)) {
      fireEvent.change(campo(rotulo), { target: { value: valor } });
    }

    await act(async () => {
      fireEvent.submit(container.querySelector('form') as HTMLFormElement);
    });
    await screen.findByRole('alert');

    for (const [rotulo, valor] of Object.entries(ENDERECO)) {
      expect(campo(rotulo).value, rotulo).toBe(valor);
    }
    expect(campo('CEP').getAttribute('aria-invalid')).toBe('true');
  });
});
