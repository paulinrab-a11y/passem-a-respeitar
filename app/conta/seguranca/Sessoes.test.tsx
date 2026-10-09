// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Sessao } from '@/lib/conta/sessoes';
import type { EstadoSessao } from './estado-sessoes';

/**
 * Para onde vai o foco quando o modal da senha sai, na lista de aparelhos
 * (#270). O botao Encerrar fica desabilitado enquanto a acao roda, e o
 * navegador tira o foco dele nesse instante: quando o modal abre, o foco esta
 * no <body>, e "devolver a quem estava focado" nao levaria a lugar nenhum.
 */
const acoes = vi.hoisted(() => ({
  encerrarSessao: vi.fn(
    async (): Promise<EstadoSessao> => ({
      recado: null,
      encerrado: null,
      precisaReautenticar: true,
    })
  ),
  reautenticarEEncerrar: vi.fn(
    async (): Promise<EstadoSessao> => ({
      recado: { tom: 'ok', texto: 'Aparelho desconectado.' },
      encerrado: 'outro',
    })
  ),
}));

vi.mock('./acoes', () => acoes);

import Sessoes from './Sessoes';

const SESSOES: Sessao[] = [
  {
    identificador: 'este',
    navegador: 'Firefox',
    sistema: 'Linux',
    rede: null,
    ultimoAcesso: '2026-10-09T12:00:00Z',
    atual: true,
  },
  {
    identificador: 'outro',
    navegador: 'Chrome',
    sistema: 'Android',
    rede: null,
    ultimoAcesso: '2026-10-08T12:00:00Z',
    atual: false,
  },
];

const encerrar = () => screen.getByRole('button', { name: 'Encerrar' });
const titulo = () => screen.getByRole('heading', { name: 'Aparelhos conectados' });

/** Clica em Encerrar e espera o modal da senha aparecer. */
async function pedeSenha() {
  await act(async () => {
    fireEvent.submit(encerrar().closest('form') as HTMLFormElement);
  });
  await screen.findByRole('dialog');
  // O que o Chrome faz com o botao que ficou desabilitado.
  (document.activeElement as HTMLElement | null)?.blur();
}

/** Espera o prazo de saida desmontar o modal: no jsdom nao ha animacao. */
async function esperaSair() {
  await act(async () => {
    await new Promise((pronto) => setTimeout(pronto, 500));
  });
}

afterEach(cleanup);

describe('Sessoes: foco na volta do modal da senha', () => {
  it('cancelar devolve o foco ao Encerrar da linha', async () => {
    render(<Sessoes sessoes={SESSOES} janelaMinutos={5} />);
    await pedeSenha();

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    await esperaSair();

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(encerrar());
  });

  it('confirmada a senha, a linha sai e o foco vai para o titulo da secao', async () => {
    render(<Sessoes sessoes={SESSOES} janelaMinutos={5} />);
    await pedeSenha();

    fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'senha-certa' } });
    await act(async () => {
      fireEvent.submit(screen.getByLabelText('Senha').closest('form') as HTMLFormElement);
    });
    await screen.findByText('Aparelho desconectado.');
    await esperaSair();

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(titulo());
  });
});
