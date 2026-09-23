import { readdirSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Invariante de `prefers-reduced-motion` que nenhum lint pega (#52).
 *
 * Quando o stagger de uma lista chega inline no `style` do elemento, zerar so a
 * `animation-duration` no bloco de movimento reduzido NAO desfaz a animacao:
 * o atraso sobrevive, e com `animation-fill-mode: backwards` o item fica
 * invisivel durante o atraso e depois aparece de uma vez. A pessoa pediu menos
 * movimento e recebeu um piscar atrasado.
 *
 * Para vencer o `style` inline so ha um caminho: `!important`.
 *
 * Sao dois testes porque um so nao segura. O primeiro exige a regra para cada
 * lista conhecida; o segundo exige que nao exista lista desconhecida. Sem o
 * segundo, a proxima lista com stagger nasceria com o mesmo defeito e ninguem
 * ficaria sabendo.
 */

const CSS = readFileSync('app/globals.css', 'utf8');

/** Arquivo que aplica stagger inline -> seletor que o CSS usa para desfazer. */
const COM_STAGGER: [string, string][] = [
  ['app/conta/pedidos/page.tsx', '.pedidos>li'],
  ['app/conta/seguranca/Sessoes.tsx', '.sessoes li'],
];

/**
 * O conteudo de cada `@media (prefers-reduced-motion:reduce){...}`.
 *
 * Contando chave por chave, e nao por regex: o bloco tem regras dentro, entao
 * um `[^}]*` pararia na primeira chave fechada e o teste passaria achando que
 * leu o bloco inteiro.
 */
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

function arquivosTsx(raiz: string): string[] {
  return readdirSync(raiz, { withFileTypes: true }).flatMap((item) => {
    const caminho = join(raiz, item.name);
    if (item.isDirectory()) return arquivosTsx(caminho);
    return item.name.endsWith('.tsx') && !item.name.endsWith('.test.tsx') ? [caminho] : [];
  });
}

describe('prefers-reduced-motion e stagger inline', () => {
  const reduzido = blocosDeMovimentoReduzido(CSS).join('\n');

  it('acha os blocos de movimento reduzido no CSS', () => {
    // Se esta contagem for a zero, os dois testes abaixo passariam vazios.
    expect(blocosDeMovimentoReduzido(CSS).length).toBeGreaterThan(5);
  });

  it.each(COM_STAGGER)('%s tem o atraso zerado com !important', (arquivo, seletor) => {
    expect(readFileSync(arquivo, 'utf8')).toContain('animationDelay');

    const regra = reduzido
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.startsWith(`${seletor}{`));

    expect(regra, `sem regra para ${seletor} em prefers-reduced-motion`).toBeDefined();
    expect(regra).toMatch(/animation-delay:\s*0m?s\s*!important/);
  });

  it('nao existe stagger inline fora da lista acima', () => {
    // `readdirSync` devolve caminho com o separador do sistema; a lista acima e
    // escrita com barra. Normalizar os dois lados evita um teste que passa no
    // Linux do CI e falha no Windows de quem esta escrevendo.
    const registrados = new Set(COM_STAGGER.map(([arquivo]) => arquivo));

    const comStagger = arquivosTsx('app')
      .filter((caminho) => /animationDelay|transitionDelay/.test(readFileSync(caminho, 'utf8')))
      .map((caminho) => caminho.split(sep).join('/'))
      .filter((caminho) => !registrados.has(caminho));

    expect(
      comStagger,
      'stagger inline novo: registre em COM_STAGGER e zere o atraso com !important'
    ).toEqual([]);
  });
});
