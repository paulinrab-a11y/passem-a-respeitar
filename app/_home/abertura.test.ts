// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';
import { fechaAbertura } from './abertura';

/**
 * O estado "abertura fechada" (#238), que a intro do script legado e o
 * HomeRuntime precisam deixar igual: `#intro` fora, trava solta, barra
 * visivel.
 */
function montaHome() {
  document.documentElement.className = 'locked';
  document.body.innerHTML = `
    <header id="bar"></header>
    <div id="intro"><button type="button" id="skip">pular</button></div>
    <main><section id="merch"></section></main>
  `;
}

const intro = () => document.getElementById('intro') as HTMLElement;
const bar = () => document.getElementById('bar') as HTMLElement;

beforeEach(montaHome);

describe('fechaAbertura', () => {
  it('tira a abertura da tela, solta a rolagem e mostra a barra', () => {
    fechaAbertura(document);

    expect(intro().classList.contains('out')).toBe(true);
    expect(intro().style.display).toBe('none');
    expect(document.documentElement.classList.contains('locked')).toBe(false);
    expect(bar().classList.contains('on')).toBe(true);
  });

  it('fechar de novo nao desfaz nada: a timeline da intro pode terminar depois', () => {
    fechaAbertura(document);
    fechaAbertura(document);

    expect(intro().classList.contains('out')).toBe(true);
    expect(intro().style.display).toBe('none');
    expect(document.documentElement.classList.contains('locked')).toBe(false);
    expect(bar().classList.contains('on')).toBe(true);
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
