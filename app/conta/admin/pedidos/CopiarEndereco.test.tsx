// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CopiarEndereco from './CopiarEndereco';

/**
 * O botao de copiar o endereco (#242). O que se prova: o texto que vai para a
 * area de transferencia e o da etiqueta inteira, o botao diz que copiou sem
 * mudar de largura, e quando o navegador nega a copia a pessoa fica sabendo.
 */

const TEXTO =
  'Ana Souza\nAvenida Paulista, 1578, apto 92\nBela Vista — São Paulo/SP\nCEP 01310-100';

const writeText = vi.fn<(texto: string) => Promise<void>>();

beforeEach(() => {
  writeText.mockReset();
  writeText.mockResolvedValue(undefined);
  // O jsdom nao tem area de transferencia.
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const botao = () => screen.getByRole('button', { name: 'Copiar endereço do pedido 12' });
const rotulo = (container: HTMLElement) => container.querySelector('.rotulo-acao') as HTMLElement;

describe('CopiarEndereco', () => {
  it('copia a etiqueta inteira e diz que copiou, para quem ve e para quem ouve', async () => {
    const { container } = render(<CopiarEndereco texto={TEXTO} pedido={12} />);

    expect(rotulo(container).hasAttribute('data-ativo')).toBe(false);

    await act(async () => {
      fireEvent.click(botao());
    });

    expect(writeText).toHaveBeenCalledWith(TEXTO);
    expect(rotulo(container).hasAttribute('data-ativo')).toBe(true);
    expect(screen.getByRole('status').textContent).toBe('Endereço copiado.');
    expect((botao() as HTMLButtonElement).disabled).toBe(false);
  });

  // Ha um botao destes por card: o nome precisa dizer de qual pedido e.
  it('o nome acessivel carrega o numero do pedido', () => {
    render(<CopiarEndereco texto={TEXTO} pedido={12} />);

    expect(botao().tagName).toBe('BUTTON');
  });

  it('enquanto a copia nao volta, o botao fica desabilitado e com a barra (#50)', async () => {
    let termina: () => void = () => {};
    writeText.mockReturnValue(
      new Promise<void>((resolve) => {
        termina = resolve;
      })
    );
    render(<CopiarEndereco texto={TEXTO} pedido={12} />);

    await act(async () => {
      fireEvent.click(botao());
    });

    expect((botao() as HTMLButtonElement).disabled).toBe(true);
    expect(botao().className).toContain('carregando');
    // Clique repetido no meio nao copia duas vezes.
    fireEvent.click(botao());
    expect(writeText).toHaveBeenCalledTimes(1);

    await act(async () => {
      termina();
    });

    expect((botao() as HTMLButtonElement).disabled).toBe(false);
    expect(botao().className).not.toContain('carregando');
  });

  it('volta ao normal sozinho: um "Copiado" eterno nao diz nada do proximo clique', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { container } = render(<CopiarEndereco texto={TEXTO} pedido={12} />);

    await act(async () => {
      fireEvent.click(botao());
    });
    expect(rotulo(container).hasAttribute('data-ativo')).toBe(true);

    act(() => {
      vi.advanceTimersByTime(2500);
    });

    expect(rotulo(container).hasAttribute('data-ativo')).toBe(false);
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('area de transferencia negada: aviso visivel apontando para o texto, e o botao volta', async () => {
    writeText.mockRejectedValue(new DOMException('negado', 'NotAllowedError'));
    const { container } = render(<CopiarEndereco texto={TEXTO} pedido={12} />);

    await act(async () => {
      fireEvent.click(botao());
    });

    const aviso = screen.getByRole('status');
    expect(aviso.textContent).toBe('Não deu para copiar. Selecione o endereço acima.');
    expect(aviso.className).toBe('admin-copiar-falhou');
    expect(rotulo(container).hasAttribute('data-ativo')).toBe(false);
    expect((botao() as HTMLButtonElement).disabled).toBe(false);
  });
});
