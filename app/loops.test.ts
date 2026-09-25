import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Duas invariantes da #52 que nenhum lint pega.
 *
 * 1. Nenhum @keyframes anima `width`, `height`, `top`, `left` ou `margin`.
 *    Essas propriedades refluem o layout a cada quadro; so `transform`,
 *    `opacity` e `filter` ficam na composicao.
 *
 * 2. Todo loop infinito e parado com movimento reduzido. Quem pediu menos
 *    movimento nao pode receber um ponto piscando e barras pulsando para
 *    sempre no canto da tela.
 *
 * Os dois leem o CSS, e nao o DOM, de proposito: o proximo loop que alguem
 * escrever cai aqui no primeiro CI, com o seletor no nome do teste.
 */
const CSS = readFileSync('app/globals.css', 'utf8');

/** Conteudo de cada `@media (prefers-reduced-motion:reduce){...}`, contando chaves. */
function blocosDeMovimentoReduzido(css: string): string[] {
  const abertura = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{/g;
  const blocos: string[] = [];
  let achado = abertura.exec(css);
  while (achado !== null) {
    let profundidade = 1;
    let i = achado.index + achado[0].length;
    const inicio = i;
    while (i < css.length && profundidade > 0) {
      if (css[i] === '{') profundidade++;
      else if (css[i] === '}') profundidade--;
      i++;
    }
    blocos.push(css.slice(inicio, i - 1));
    achado = abertura.exec(css);
  }
  return blocos;
}

const REDUZIDO = blocosDeMovimentoReduzido(CSS).join('\n');

describe('keyframes so animam o que nao reflui (#52)', () => {
  const keyframes = [...CSS.matchAll(/@keyframes\s+([\w-]+)\s*\{((?:[^{}]*\{[^{}]*\})*)\s*\}/g)];

  it('acha os keyframes', () => {
    expect(keyframes.length).toBeGreaterThan(5);
  });

  it.each(keyframes.map((k) => [k[1], k[2]]))('%s nao anima layout', (_nome, corpo) => {
    expect(corpo).not.toMatch(
      /(?:^|[;{\s])(?:width|height|top|left|right|bottom|margin[\w-]*|padding[\w-]*)\s*:/
    );
  });
});

describe('loop infinito para com movimento reduzido (#52)', () => {
  // Cada regra que declara `infinite`, com o seletor dela.
  const loops = [
    ...CSS.matchAll(/(?:^|\n)([^{}\n]+)\{[^{}]*animation[^{}]*\binfinite\b[^{}]*\}/g),
  ].map((m) => m[1].trim());

  it('acha os loops conhecidos', () => {
    expect(loops).toEqual(
      expect.arrayContaining(['#rec i', '#hero .desce::after', '.tocando .eq i'])
    );
  });

  it.each(loops.map((s) => [s]))('%s tem animation:none com movimento reduzido', (seletor) => {
    const escapado = seletor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regra = new RegExp(`${escapado}\\{[^{}]*animation\\s*:\\s*none`);
    expect(REDUZIDO).toMatch(regra);
  });
});
