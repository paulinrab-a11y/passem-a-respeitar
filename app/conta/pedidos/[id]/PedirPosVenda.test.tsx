// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EstadoPosVenda } from './estado';

/**
 * Os botoes de pedir pelo site (#379): dois passos, recibo na hora com o
 * protocolo, e o foco onde a pessoa precisa dele.
 */

const PEDIDO = '44444444-4444-4444-8444-444444444444';

const pedirPosVenda = vi.fn(
  async (_a: EstadoPosVenda, form: FormData): Promise<EstadoPosVenda> => ({
    erro: null,
    recebido: {
      tipo: form.get('tipo') as 'cancelamento',
      protocolo: 'PV-ABCDEF12',
      criadoEm: '2026-10-15T22:00:00Z',
      jaExistia: false,
    },
  })
);

vi.mock('./acoes', () => ({
  pedirPosVenda: (a: EstadoPosVenda, f: FormData) => pedirPosVenda(a, f),
}));

import PedirPosVenda from './PedirPosVenda';

afterEach(() => {
  cleanup();
  pedirPosVenda.mockClear();
});

describe('PedirPosVenda', () => {
  it('um botao por tipo que cabe, e nenhum formulario antes do clique', () => {
    const { container } = render(
      <PedirPosVenda pedido={PEDIDO} tipos={['arrependimento', 'troca', 'defeito']} />
    );

    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Quero desistir da compra',
      'Trocar o tamanho',
      'Avisar de defeito',
    ]);
    expect(container.querySelector('form')).toBeNull();
  });

  it('o clique abre a confirmacao, com o que acontece depois, e o foco vai para a mensagem', () => {
    render(<PedirPosVenda pedido={PEDIDO} tipos={['cancelamento']} />);

    fireEvent.click(screen.getByRole('button', { name: 'Pedir cancelamento' }));

    expect(screen.getByRole('form', { name: 'Pedir cancelamento' })).toBeTruthy();
    expect(screen.getByText(/devolve tudo o que você pagou/)).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText('Quer contar o motivo? (opcional)'));
    expect(pedirPosVenda).not.toHaveBeenCalled();
  });

  it('voltar fecha sem enviar', () => {
    render(<PedirPosVenda pedido={PEDIDO} tipos={['cancelamento']} />);

    fireEvent.click(screen.getByRole('button', { name: 'Pedir cancelamento' }));
    fireEvent.click(screen.getByRole('button', { name: 'Voltar' }));

    expect(screen.queryByRole('form')).toBeNull();
    expect(pedirPosVenda).not.toHaveBeenCalled();
  });

  it('confirmar envia pedido, tipo e mensagem, e mostra o protocolo com foco nele', async () => {
    render(<PedirPosVenda pedido={PEDIDO} tipos={['cancelamento']} />);

    fireEvent.click(screen.getByRole('button', { name: 'Pedir cancelamento' }));
    fireEvent.change(screen.getByLabelText('Quer contar o motivo? (opcional)'), {
      target: { value: 'comprei errado' },
    });
    await act(async () => {
      fireEvent.submit(screen.getByRole('form'));
    });

    const enviado = pedirPosVenda.mock.calls[0][1];
    expect(Object.fromEntries(enviado.entries())).toEqual({
      pedido: PEDIDO,
      tipo: 'cancelamento',
      mensagem: 'comprei errado',
    });

    const recibo = screen.getByRole('status');
    expect(recibo.textContent).toMatch(/Recebemos o seu pedido: cancelamento\./);
    expect(recibo.textContent).toContain('PV-ABCDEF12');
    expect(recibo.textContent).toMatch(/até 2 dias úteis/);
    expect(document.activeElement).toBe(recibo);
    expect(screen.queryByRole('form')).toBeNull();
  });
});

describe('estilo', () => {
  const CSS = readFileSync('app/globals.css', 'utf8');
  const bloco = CSS.slice(CSS.indexOf('/* Pedir pelo site (#379)'));

  it('entrada so com transform e opacity, e sem deslocamento com movimento reduzido', () => {
    expect(bloco.length).toBeGreaterThan(30);
    const quadros = /@keyframes pos-venda-entra\{([^}]*\{[^}]*\})+\}/.exec(bloco)?.[0] ?? '';
    expect(quadros).not.toBe('');
    for (const prop of quadros.matchAll(/([a-z-]+):/g)) {
      expect(['opacity', 'transform']).toContain(prop[1]);
    }
    expect(bloco).toMatch(/prefers-reduced-motion:reduce\)\{[^}]*animation-name:so-fade/);
  });
});
