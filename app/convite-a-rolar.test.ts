import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Convite a rolar do hero (#156). Os criterios da issue:
 *
 *   - o loop para na primeira rolagem
 *   - voltar ao topo nao religa
 *   - movimento reduzido continua sem loop
 */
const CSS = readFileSync('app/globals.css', 'utf8');
const JS = readFileSync('app/_home/legacy-site.js', 'utf8');

const convite = JS.slice(JS.indexOf('(function convite(){'), JS.indexOf('(function montaElos(){'));

function blocosDeMovimentoReduzido(css: string): string {
  const abertura = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{/g;
  const blocos: string[] = [];
  let achado = abertura.exec(css);
  while (achado !== null) {
    let fundo = 1;
    let i = achado.index + achado[0].length;
    const inicio = i;
    while (i < css.length && fundo > 0) {
      if (css[i] === '{') fundo++;
      else if (css[i] === '}') fundo--;
      i++;
    }
    blocos.push(css.slice(inicio, i - 1));
    achado = abertura.exec(css);
  }
  return blocos.join('\n');
}

describe('a linha parada', () => {
  const regra = CSS.match(/#hero \.desce\.rolou::after\{([^}]*)\}/)?.[1] ?? '';

  it('existe', () => {
    expect(regra).not.toBe('');
  });

  it('nao e loop', () => {
    expect(regra).not.toContain('infinite');
  });

  it('entra com fade curto e fica: so opacidade, e o estado final permanece', () => {
    const [, nome, duracao] = regra.match(/animation:([\w-]+) (\.?\d+(?:\.\d+)?)s /) ?? [];

    expect(nome).toBe('so-fade');
    expect(Number(duracao)).toBeLessThanOrEqual(0.3);
    expect(regra).toMatch(/\bboth\b/);
    expect(CSS).toContain('@keyframes so-fade{from{opacity:0}to{opacity:1}}');
  });

  it('ganha do loop pela especificidade, sem !important', () => {
    expect(regra).not.toContain('!important');
    expect(CSS.indexOf('#hero .desce.rolou::after{')).toBeGreaterThan(
      CSS.indexOf('#hero .desce::after{')
    );
  });

  it('com movimento reduzido nao ha animacao nenhuma, nem a de parar', () => {
    expect(blocosDeMovimentoReduzido(CSS)).toMatch(
      /#hero \.desce\.rolou::after,#hero \.desce::after\{animation:none\}/
    );
  });
});

describe('quem para o loop', () => {
  it('o trecho existe no script da home', () => {
    expect(convite.length).toBeGreaterThan(0);
  });

  it('escuta a rolagem sem travar a rolagem', () => {
    expect(convite).toMatch(/addEventListener\('scroll', aoRolar, \{ passive:true \}\)/);
  });

  it('so conta rolagem que saiu do topo', () => {
    expect(convite).toMatch(/if \(scrollY < \d+\) return;/);
  });

  it('para de escutar depois da primeira', () => {
    expect(convite).toContain("removeEventListener('scroll', aoRolar)");
  });

  it('espera o ciclo acabar antes de parar, e so uma vez', () => {
    expect(convite).toMatch(
      /addEventListener\('animationiteration', \(\)=> desce\.classList\.add\('rolou'\), \{ once:true \}\)/
    );
  });

  it('nada no script devolve o loop', () => {
    expect(JS).not.toMatch(/classList\.(?:remove|toggle)\('rolou'/);
  });
});
