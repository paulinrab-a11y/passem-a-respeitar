// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { prendeFundo, soltaFundo } from '@/app/_ui/fundo-inerte';
import { atalhoLivre, mostraTocando } from './teclado';

/**
 * A home pelo teclado (#280). A tecla e disparada no elemento, como o
 * navegador faz com o foco nele, e o que se le e o evento que chega ao
 * documento — onde os atalhos do script legado escutam.
 */

function montaHome() {
  document.body.innerHTML = `
    <main>
      <button type="button" id="comprar">Comprar</button>
      <form id="formConvite"><input id="cod" /><button type="submit">entrar</button></form>
      <textarea id="conciergeTexto"></textarea>
      <fieldset class="frete-opcoes"><input type="radio" id="sedex" name="frete" /></fieldset>
      <select id="tamanho"><option>M</option></select>
      <div contenteditable="true"><p id="editavel">texto</p></div>
      <div contenteditable="false"><p id="fixo">texto</p></div>
    </main>
    <button type="button" class="tocando" id="tocando" tabindex="-1" aria-hidden="true">
      <span id="tocandoNome"></span>
    </button>
    <div id="loja"><button type="button" id="fecharLoja">fechar</button></div>
  `;
}

const el = (id: string) => document.getElementById(id) as HTMLElement;

/** Aperta `tecla` em `alvo` e devolve o que `atalhoLivre` disse no documento. */
function aperta(alvo: EventTarget, tecla: string, mods: KeyboardEventInit = {}): boolean {
  let livre: boolean | undefined;
  const ouve = (e: KeyboardEvent) => {
    livre = atalhoLivre(e);
  };
  document.addEventListener('keydown', ouve);
  alvo.dispatchEvent(new KeyboardEvent('keydown', { key: tecla, bubbles: true, ...mods }));
  document.removeEventListener('keydown', ouve);
  if (livre === undefined) throw new Error('a tecla nao chegou ao documento');
  return livre;
}

beforeEach(montaHome);

describe('atalhoLivre', () => {
  it('fora de campo, N e as setas sao da home', () => {
    expect(aperta(document.body, 'n')).toBe(true);
    expect(aperta(document.body, 'N', { shiftKey: true })).toBe(true);
    expect(aperta(el('comprar'), 'ArrowRight')).toBe(true);
    expect(aperta(el('fecharLoja'), 'ArrowLeft')).toBe(true);
  });

  it.each([
    ['codigo do convite', 'cod'],
    ['concierge', 'conciergeTexto'],
    ['opcao de frete', 'sedex'],
    ['select', 'tamanho'],
    ['area editavel', 'editavel'],
  ])('no %s, a tecla e de quem digita', (_, id) => {
    for (const tecla of ['n', 'N', 'ArrowLeft', 'ArrowRight']) {
      expect(aperta(el(id), tecla), `${tecla} em #${id}`).toBe(false);
    }
  });

  it('dentro de contenteditable="false" nao ha o que digitar', () => {
    expect(aperta(el('fixo'), 'n')).toBe(true);
  });

  it.each([
    ['Ctrl', { ctrlKey: true }],
    ['Cmd', { metaKey: true }],
    ['Alt', { altKey: true }],
  ])('com %s, a tecla e do navegador', (_, mods) => {
    expect(aperta(document.body, 'n', mods)).toBe(false);
    expect(aperta(el('comprar'), 'ArrowRight', mods)).toBe(false);
  });

  it('tecla na janela, sem elemento, segue livre', () => {
    let livre: boolean | undefined;
    const ouve = (e: KeyboardEvent) => {
      livre = atalhoLivre(e);
    };
    window.addEventListener('keydown', ouve);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n' }));
    window.removeEventListener('keydown', ouve);

    expect(livre).toBe(true);
  });
});

describe('mostraTocando', () => {
  it('apagado, sai do Tab e do leitor de tela; aceso, entra', () => {
    const pill = el('tocando');

    mostraTocando(pill, true);
    expect(pill.classList.contains('on')).toBe(true);
    expect(pill.hasAttribute('tabindex')).toBe(false);
    expect(pill.hasAttribute('aria-hidden')).toBe(false);
    expect(pill.tabIndex).toBe(0);

    mostraTocando(pill, false);
    expect(pill.classList.contains('on')).toBe(false);
    expect(pill.tabIndex).toBe(-1);
    expect(pill.getAttribute('aria-hidden')).toBe('true');
  });

  it('acender com a loja aberta nao solta o fundo inerte dela', () => {
    const pill = el('tocando');
    mostraTocando(pill, true);
    prendeFundo(el('loja'), 'loja');
    expect(pill.hasAttribute('inert')).toBe(true);

    // N com a loja aberta: o beat troca e o indicador acende de novo, atras.
    mostraTocando(pill, true);
    expect(pill.hasAttribute('inert')).toBe(true);

    soltaFundo(document, 'loja');
    expect(pill.hasAttribute('inert')).toBe(false);
  });
});

/**
 * O contrato com o script legado. Ele nao roda no jsdom (depende do three e
 * do gsap); o que se segura aqui e que ele passa pela guarda e pelo
 * indicador. A marcacao do indicador e conferida em app/semantica.test.ts,
 * com a home renderizada.
 */
describe('script legado', () => {
  const SCRIPT = readFileSync('app/_home/legacy-site.js', 'utf8');

  it('todo atalho de N ou seta passa pela guarda', () => {
    const atalhos = SCRIPT.split('\n').filter(
      (linha) => linha.includes("'keydown'") && /'(?:n|N|ArrowLeft|ArrowRight)'/.test(linha)
    );

    expect(atalhos).toHaveLength(2);
    for (const linha of atalhos) expect(linha).toContain('atalhoLivre(e)');
  });

  it('o indicador so acende e apaga por mostraTocando', () => {
    expect(SCRIPT).not.toMatch(/pill\.classList/);
    expect(SCRIPT.match(/mostraTocando\(pill, (?:true|false)\)/g)).toHaveLength(3);
  });
});
