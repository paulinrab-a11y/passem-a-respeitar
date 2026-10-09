// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fimDaAnimacao } from '@/app/_ui/fim-da-animacao';

vi.mock('@/app/conta/acoes', () => ({ sair: vi.fn() }));

const { default: BarraConta, LugarDoMenuConta } = await import('./BarraConta');

/**
 * O menu da conta na barra da home, por teclado (#262).
 *
 * O jsdom nao anda pelo Tab, entao "Tab para fora" aqui e o foco caindo num
 * elemento de fora, que e o que o navegador faz e o que o painel ouve. A
 * ordem do Tab em si sai da ordem do DOM, conferida abaixo; a suite de ponta
 * a ponta aperta as teclas de verdade.
 */

const LOGADA = { logado: true, nome: 'Leitora Da Suite', iniciais: 'LS' };

/** A barra como a home monta: botao dentro do <header>, o lugar logo depois. */
function Home() {
  return (
    <>
      <header>
        <nav aria-label="Ações">
          <BarraConta />
        </nav>
      </header>
      <LugarDoMenuConta />
      <main>
        <a href="#hero">conteúdo da página</a>
      </main>
    </>
  );
}

async function monta(arvore = <Home />) {
  render(arvore);
  return screen.findByRole('button', { name: /Leitora/ });
}

const painel = () => screen.queryByRole('navigation', { name: 'Sua conta' });
const link = (nome: string) => screen.getByRole('link', { name: nome });

async function abre(gatilho: HTMLElement) {
  await act(async () => {
    fireEvent.click(gatilho);
  });
  return painel() as HTMLElement;
}

/** Fim da saida: o painel so desmonta quando a animacao termina. */
function terminaSaida() {
  const caixa = document.querySelector('.menu-conta');
  if (caixa) fimDaAnimacao(caixa);
}

beforeEach(() => {
  vi.stubGlobal('fetch', () => Promise.resolve(new Response(JSON.stringify(LOGADA))));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('menu da conta na barra (#262)', () => {
  it('e um disclosure: botao com aria-expanded, sem prometer um menu de setas', async () => {
    const gatilho = await monta();
    expect(gatilho.getAttribute('aria-expanded')).toBe('false');
    expect(gatilho.hasAttribute('aria-haspopup')).toBe(false);

    const nav = await abre(gatilho);
    expect(gatilho.getAttribute('aria-expanded')).toBe('true');
    expect(gatilho.getAttribute('aria-controls')).toBe(nav.parentElement?.id);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.queryAllByRole('menuitem')).toHaveLength(0);

    // Uma lista: o leitor de tela anuncia "lista, 4 itens".
    expect(nav.querySelectorAll('ul > li')).toHaveLength(4);
    expect(screen.getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual([
      '/conta',
      '/conta/pedidos',
      '/conta/seguranca',
      '#hero',
    ]);
    expect(screen.getByRole('button', { name: 'Sair' })).toBeTruthy();
  });

  it('abrir leva o foco para "Conta"', async () => {
    const gatilho = await monta();
    gatilho.focus();
    await abre(gatilho);

    expect(document.activeElement).toBe(link('Conta'));
  });

  it('o painel entra logo depois do <header>, antes da pagina, na ordem do Tab', async () => {
    const gatilho = await monta();
    const nav = await abre(gatilho);

    expect(document.getElementById('lugar-do-menu-conta')?.contains(nav)).toBe(true);
    const depois = (a: Node, b: Node) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(depois(gatilho, nav)).toBe(true);
    expect(depois(nav, link('conteúdo da página'))).toBe(true);
  });

  it('foco saindo para a pagina fecha o painel e fica onde a pessoa foi', async () => {
    const gatilho = await monta();
    await abre(gatilho);
    link('Segurança').focus();
    expect(painel()).not.toBeNull();

    const fora = link('conteúdo da página');
    act(() => fora.focus());

    expect(document.querySelector('.menu-conta')?.classList.contains('fechando')).toBe(true);
    terminaSaida();
    expect(painel()).toBeNull();
    expect(gatilho.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(fora);
  });

  it('voltar do painel para o botao nao fecha', async () => {
    const gatilho = await monta();
    await abre(gatilho);

    act(() => gatilho.focus());

    expect(document.querySelector('.menu-conta')?.classList.contains('fechando')).toBe(false);
    expect(gatilho.getAttribute('aria-expanded')).toBe('true');
  });

  it('Escape fecha e devolve o foco ao botao', async () => {
    const gatilho = await monta();
    await abre(gatilho);
    link('Pedidos').focus();

    act(() => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });

    expect(document.activeElement).toBe(gatilho);
    // Saindo, o painel ainda esta no DOM, mas fora do alcance do Tab.
    expect(document.querySelector('.menu-conta')?.hasAttribute('inert')).toBe(true);
    terminaSaida();
    expect(painel()).toBeNull();
    expect(document.activeElement).toBe(gatilho);
  });

  it('reabrir durante a saida devolve o foco a "Conta" e tira o inert', async () => {
    const gatilho = await monta();
    await abre(gatilho);
    act(() => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });

    await abre(gatilho);

    const caixa = document.querySelector('.menu-conta');
    expect(caixa?.classList.contains('fechando')).toBe(false);
    expect(caixa?.hasAttribute('inert')).toBe(false);
    expect(document.activeElement).toBe(link('Conta'));
  });

  it('sem o lugar na pagina, o painel ainda abre, no fim do <body>', async () => {
    const gatilho = await monta(<BarraConta />);
    const nav = await abre(gatilho);

    expect(nav.parentElement?.parentElement).toBe(document.body);
    expect(document.activeElement).toBe(link('Conta'));
  });
});
