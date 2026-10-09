// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';
import { prendeFundo, soltaFundo } from './fundo-inerte';

/**
 * O fundo inerte dos modais feitos a mao (#270). O jsdom nao implementa o
 * efeito do `inert` — tirar foco e clique —, so guarda o atributo. E o
 * atributo que se confere aqui; o Tab preso de verdade e da suite de ponta a
 * ponta.
 */
function montaPagina() {
  document.body.innerHTML = `
    <header id="bar"><button type="button">som</button></header>
    <div id="intro"><button type="button" id="skip">pular</button></div>
    <main><a href="#merch">merch</a></main>
    <div id="loja"><button type="button">fechar</button></div>
    <div id="sala"><button type="button">fechar</button></div>
    <script></script>
  `;
}

const el = (id: string) => document.getElementById(id) as HTMLElement;
const main = () => document.querySelector('main') as HTMLElement;
const inertes = () =>
  Array.from(document.body.children)
    .filter((e) => e.hasAttribute('inert'))
    .map((e) => e.id || e.tagName.toLowerCase());

beforeEach(montaPagina);

describe('prendeFundo', () => {
  it('torna inerte tudo o que esta fora do modal, e o modal nao', () => {
    prendeFundo(el('loja'), 'loja');

    expect(inertes()).toEqual(['bar', 'intro', 'main', 'sala']);
    expect(el('loja').hasAttribute('inert')).toBe(false);
  });

  it('nao marca o que nao aparece na tela', () => {
    prendeFundo(el('loja'), 'loja');

    expect(document.querySelector('script')?.hasAttribute('inert')).toBe(false);
  });

  it('sobe ate o <body>: os irmaos de cada ancestral tambem ficam de fora', () => {
    document.body.innerHTML = `
      <header id="bar"></header>
      <div id="raiz">
        <nav id="menu"></nav>
        <div id="modal"></div>
      </div>
    `;

    prendeFundo(el('modal'), 'modal');

    expect(el('bar').hasAttribute('inert')).toBe(true);
    expect(el('menu').hasAttribute('inert')).toBe(true);
    // O caminho ate o modal fica vivo: inerte ali levaria o modal junto.
    expect(el('raiz').hasAttribute('inert')).toBe(false);
    expect(el('modal').hasAttribute('inert')).toBe(false);
  });

  it('prender duas vezes pelo mesmo dono nao anota duas vezes', () => {
    prendeFundo(el('intro'), 'abertura');
    prendeFundo(el('intro'), 'abertura');

    expect(main().getAttribute('data-inerte-por')).toBe('abertura');
  });
});

describe('soltaFundo', () => {
  it('devolve o fundo inteiro', () => {
    prendeFundo(el('loja'), 'loja');
    soltaFundo(document, 'loja');

    expect(inertes()).toEqual([]);
    expect(document.querySelectorAll('[data-inerte-por]')).toHaveLength(0);
  });

  it('nao solta o que outro dono ainda segura, feche quem fechar primeiro', () => {
    prendeFundo(el('sala'), 'sala');
    prendeFundo(el('loja'), 'loja');

    soltaFundo(document, 'sala');
    // A loja continua na tela: a pagina atras dela segue inerte.
    expect(main().hasAttribute('inert')).toBe(true);
    expect(main().getAttribute('data-inerte-por')).toBe('loja');

    soltaFundo(document, 'loja');
    expect(inertes()).toEqual([]);
  });

  it('nao mexe no que ja era inerte por outra mao', () => {
    main().setAttribute('inert', '');

    prendeFundo(el('loja'), 'loja');
    soltaFundo(document, 'loja');

    expect(main().hasAttribute('inert')).toBe(true);
    expect(inertes()).toEqual(['main']);
  });

  it('soltar sem ter prendido nao lanca nem muda nada', () => {
    expect(() => soltaFundo(document, 'loja')).not.toThrow();
    expect(inertes()).toEqual([]);
  });
});
