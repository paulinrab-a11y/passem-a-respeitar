// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';
import { fechaAbertura, prendeAbertura } from './abertura';

/**
 * O estado "abertura fechada" (#238), que a intro do script legado e o
 * HomeRuntime precisam deixar igual: `#intro` fora, trava solta, barra
 * visivel. E, desde a #270, o fundo inerte enquanto a abertura esta na tela,
 * solto quando ela sai, com o foco que estava nela indo para a barra.
 */
function montaHome() {
  document.documentElement.className = 'locked';
  document.body.innerHTML = `
    <header id="bar"><button type="button" id="som">som</button></header>
    <div id="intro"><button type="button" id="skip">pular</button></div>
    <main><section id="merch"><a href="#merch">merch</a></section></main>
    <button type="button" id="abrirConcierge">concierge</button>
  `;
}

const intro = () => document.getElementById('intro') as HTMLElement;
const bar = () => document.getElementById('bar') as HTMLElement;
const main = () => document.querySelector('main') as HTMLElement;
const concierge = () => document.getElementById('abrirConcierge') as HTMLElement;
const som = () => document.getElementById('som') as HTMLButtonElement;
const skip = () => document.getElementById('skip') as HTMLButtonElement;

beforeEach(montaHome);

describe('prendeAbertura', () => {
  it('com a abertura na tela, a barra, a pagina e o concierge ficam inertes', () => {
    prendeAbertura(document);

    expect(bar().hasAttribute('inert')).toBe(true);
    expect(main().hasAttribute('inert')).toBe(true);
    expect(concierge().hasAttribute('inert')).toBe(true);
    expect(intro().hasAttribute('inert')).toBe(false);
  });

  it('abertura ja fechada nao prende nada', () => {
    fechaAbertura(document);
    prendeAbertura(document);

    expect(document.querySelectorAll('[inert]')).toHaveLength(0);
  });
});

describe('fechaAbertura', () => {
  it('tira a abertura da tela, solta a rolagem e mostra a barra', () => {
    fechaAbertura(document);

    expect(intro().classList.contains('out')).toBe(true);
    expect(intro().style.display).toBe('none');
    expect(document.documentElement.classList.contains('locked')).toBe(false);
    expect(bar().classList.contains('on')).toBe(true);
  });

  it('solta o fundo que a abertura prendeu', () => {
    prendeAbertura(document);
    fechaAbertura(document);

    expect(document.querySelectorAll('[inert]')).toHaveLength(0);
  });

  it('com o foco em pular, leva o foco para o som da barra', () => {
    prendeAbertura(document);
    skip().focus();

    fechaAbertura(document);

    expect(document.activeElement).toBe(som());
  });

  it('sem foco na abertura, nao poe foco em nada', () => {
    prendeAbertura(document);

    fechaAbertura(document);

    expect(document.activeElement).toBe(document.body);
  });

  it('fechar de novo nao desfaz nada: a timeline da intro pode terminar depois', () => {
    prendeAbertura(document);
    skip().focus();
    fechaAbertura(document);
    // A pessoa ja seguiu adiante quando a timeline termina.
    const merch = document.querySelector('#merch a') as HTMLAnchorElement;
    merch.focus();
    fechaAbertura(document);

    expect(intro().classList.contains('out')).toBe(true);
    expect(intro().style.display).toBe('none');
    expect(document.documentElement.classList.contains('locked')).toBe(false);
    expect(bar().classList.contains('on')).toBe(true);
    expect(document.activeElement).toBe(merch);
  });

  it('so mexe no que e da abertura: as outras classes da raiz ficam', () => {
    document.documentElement.className = 'locked sem-webgl';

    fechaAbertura(document);

    expect(document.documentElement.className).toBe('sem-webgl');
  });

  it('sem #intro nem #bar na pagina, solta a trava e nao lanca', () => {
    document.body.innerHTML = '<main></main>';

    expect(() => fechaAbertura(document)).not.toThrow();
    expect(document.documentElement.classList.contains('locked')).toBe(false);
  });
});
