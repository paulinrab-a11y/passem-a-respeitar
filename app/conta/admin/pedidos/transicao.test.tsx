// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fimDaAnimacao } from '@/app/_ui/fim-da-animacao';
import type { EstadoAdmin } from './estado';

/**
 * Mudanca de status na tela administrativa (#157). Os criterios da issue:
 *
 *   - o selo troca com fade curto
 *   - os botoes da etapa seguinte entram sem empurrar o card
 *   - movimento reduzido: sem deslocamento
 */

const PEDIDO = '11111111-1111-4111-8111-111111111111';

vi.mock('./acoes', () => ({
  mudarStatus: vi.fn(
    async (): Promise<EstadoAdmin> => ({
      recado: { tom: 'ok', texto: 'Status atualizado.' },
      pedido: '11111111-1111-4111-8111-111111111111',
    })
  ),
}));

import MudarStatus from './MudarStatus';
import Selo from './Selo';

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const selo = (container: HTMLElement) => container.querySelector('.pedido-status') as HTMLElement;

describe('selo', () => {
  it('na carga da pagina chega parado: sem entrada, sem saida', () => {
    const { container } = render(<Selo rotulo="Pago" tom="normal" />);

    expect(selo(container).className).toBe('pedido-status normal');
    expect(selo(container).textContent).toBe('Pago');
  });

  it('quando o status muda, o antigo sai primeiro, com o texto e o tom DELE', () => {
    const { container, rerender } = render(<Selo rotulo="Pago" tom="normal" />);

    rerender(<Selo rotulo="Cancelado" tom="apagado" />);

    expect(container.querySelectorAll('.pedido-status')).toHaveLength(1);
    expect(selo(container).textContent).toBe('Pago');
    expect(selo(container).className).toBe('pedido-status normal saindo');
  });

  it('o novo entra quando a saida acaba, como elemento novo', () => {
    const { container, rerender } = render(<Selo rotulo="Pago" tom="normal" />);
    const antigo = selo(container);

    rerender(<Selo rotulo="Em produção" tom="normal" />);
    fimDaAnimacao(antigo);

    expect(selo(container)).not.toBe(antigo);
    expect(selo(container).textContent).toBe('Em produção');
    expect(selo(container).className).toBe('pedido-status normal trocou');
  });

  it('sem `animationend`, o prazo troca: o selo antigo nao fica preso', () => {
    const { container, rerender } = render(<Selo rotulo="Pago" tom="normal" />);

    rerender(<Selo rotulo="Enviado" tom="normal" />);
    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(selo(container).textContent).toBe('Enviado');
  });

  it('o mesmo status de novo nao anima nada', () => {
    const { container, rerender } = render(<Selo rotulo="Pago" tom="normal" />);
    const antigo = selo(container);

    rerender(<Selo rotulo="Pago" tom="normal" />);

    expect(selo(container)).toBe(antigo);
    expect(selo(container).className).toBe('pedido-status normal');
  });
});

describe('botoes da etapa seguinte', () => {
  const botoes = (container: HTMLElement) =>
    container.querySelector('.admin-botoes') as HTMLElement;

  it('na carga da pagina chegam parados', () => {
    const { container } = render(<MudarStatus pedido={PEDIDO} status="pago" />);

    expect(botoes(container).className).toBe('admin-botoes');
  });

  it('depois da mudanca, os da etapa nova sao elementos novos, com entrada', () => {
    const { container, rerender } = render(<MudarStatus pedido={PEDIDO} status="pago" />);
    const antigos = botoes(container);

    rerender(<MudarStatus pedido={PEDIDO} status="em_producao" />);

    expect(botoes(container)).not.toBe(antigos);
    expect(botoes(container).className).toBe('admin-botoes entrou');
  });

  it('o motivo digitado nao e remontado junto com os botoes', () => {
    const { rerender } = render(<MudarStatus pedido={PEDIDO} status="pago" />);
    const campo = screen.getByLabelText('Motivo (opcional)');

    rerender(<MudarStatus pedido={PEDIDO} status="em_producao" />);

    expect(screen.getByLabelText('Motivo (opcional)')).toBe(campo);
  });

  it('na ultima etapa, o aviso entra animado e o recado da mudanca continua na tela', async () => {
    const { container, rerender } = render(<MudarStatus pedido={PEDIDO} status="entregue" />);

    await act(async () => {
      fireEvent.submit(container.querySelector('form') as HTMLFormElement);
    });
    rerender(<MudarStatus pedido={PEDIDO} status="reembolsado" />);

    expect(screen.getByText('Sem próxima etapa.').className).toBe(
      'detalhe-nota admin-final entrou'
    );
    expect(screen.getByText('Status atualizado.').getAttribute('role')).toBe('alert');
    expect(container.querySelector('form')).toBeNull();
  });

  it('pedido que ja chegou na ultima etapa mostra o aviso parado', () => {
    render(<MudarStatus pedido={PEDIDO} status="cancelado" />);

    expect(screen.getByText('Sem próxima etapa.').className).toBe('detalhe-nota admin-final');
  });
});

describe('estilo', () => {
  const CSS = readFileSync('app/globals.css', 'utf8');

  const corpo = (nome: string) =>
    CSS.match(new RegExp(`@keyframes ${nome}\\{((?:[^{}]*\\{[^{}]*\\})*)\\}`))?.[1] ?? '';

  const propriedades = (nome: string) =>
    [...corpo(nome).matchAll(/(?:\{|;)\s*([a-z-]+)\s*:/g)].map((m) => m[1]);

  it('o selo troca so com opacidade: nao muda de tamanho nem de lugar', () => {
    expect(propriedades('selo-entra')).toEqual(['opacity', 'opacity']);
    expect(propriedades('selo-sai')).toEqual(['opacity', 'opacity']);
  });

  it('a saida do selo e mais curta que a entrada, e as duas sao curtas', () => {
    const entrada = Number(
      CSS.match(/\.pedido-status\.trocou\{animation:selo-entra \.(\d+)s /)?.[1]
    );
    const saida = Number(CSS.match(/\.pedido-status\.saindo\{animation:selo-sai \.(\d+)s /)?.[1]);

    expect(saida).toBeLessThan(entrada);
    expect(entrada).toBeLessThanOrEqual(25);
  });

  it('os botoes entram sem ocupar espaco a mais: so opacidade e transform', () => {
    expect(
      propriedades('admin-etapa-entra').filter((p) => !/^(opacity|transform)$/.test(p))
    ).toEqual([]);
    expect(corpo('admin-etapa-entra')).toMatch(/translateY\(4px\)/);
  });

  it('os botoes esperam o selo antigo sair', () => {
    const [, atraso] =
      CSS.match(
        /\.admin-botoes\.entrou,\.admin-final\.entrou\{animation:admin-etapa-entra \.2s cubic-bezier\([\d.,]+\) (\.\d+)s backwards\}/
      ) ?? [];

    expect(Number(atraso)).toBe(0.12);
  });

  it('nenhuma entrada vale na carga da pagina: todas pedem a classe da mudanca', () => {
    expect(CSS).not.toMatch(/(?:^|\n)\.admin-botoes\{[^}]*animation/);
    expect(CSS).not.toMatch(/(?:^|\n)\.pedido-status\{[^}]*animation/);
  });

  it('com movimento reduzido, fade sem deslocamento', () => {
    // O bloco de movimento reduzido que vem logo depois das regras da #157.
    const depois = CSS.slice(CSS.indexOf('.admin-botoes.entrou,.admin-final.entrou{animation:'));
    const reduzido =
      depois.match(/@media \(prefers-reduced-motion:reduce\)\{((?:[^{}]*\{[^{}]*\})*)\s*\}/)?.[1] ??
      '';

    expect(reduzido).toContain('.pedido-status.trocou{animation-name:so-fade}');
    expect(reduzido).toContain('.pedido-status.saindo{animation-name:so-fade-sai}');
    expect(reduzido).toContain('.admin-botoes.entrou,.admin-final.entrou{animation-name:so-fade}');
    expect(CSS).toContain('@keyframes so-fade{from{opacity:0}to{opacity:1}}');
  });
});
