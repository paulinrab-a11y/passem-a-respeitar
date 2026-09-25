import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Invariante da #96 que nenhum lint pega.
 *
 * `section{min-height:100vh}` existia para as secoes de tela cheia da home e
 * alcancava TODO <section> do site — inclusive os blocos de conteudo das
 * telas de conta, que ganhavam um buraco de uma tela inteira cada. A regra
 * saiu; cada secao da home carrega o proprio min-height. Se alguem devolver
 * o min-height a regra generica "para arrumar a home", este teste cai.
 */
const CSS = readFileSync('app/globals.css', 'utf8');

/** As declaracoes do primeiro bloco cujo seletor e exatamente `seletor`. */
function declaracoesDe(seletor: string): string {
  const escapado = seletor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const achado = new RegExp(`(?:^|[}\\n])${escapado}\\{([^}]*)\\}`, 'm').exec(CSS);
  return achado?.[1] ?? '';
}

describe('altura das secoes (#96)', () => {
  it('a regra generica de <section> nao define min-height', () => {
    const base = declaracoesDe('section');

    expect(base).toContain('position:relative');
    expect(base).not.toMatch(/min-height/);
  });

  // A home continua de tela cheia — mas por escolha de cada secao.
  it.each(['#hero', '#clipe', '#merch'])('%s tem o proprio min-height de tela cheia', (id) => {
    expect(declaracoesDe(id)).toMatch(/min-height:100vh/);
  });

  it('#fim continua mais alto que a tela, por conta propria', () => {
    expect(declaracoesDe('#fim')).toMatch(/min-height:1\d\dvh/);
  });

  // O remendo local da #42 sai junto: sem a regra generica, nao ha o que
  // desfazer. Mante-lo seria deixar uma pista falsa de que o problema existe.
  it('.detalhe-bloco nao precisa mais desfazer nada', () => {
    expect(declaracoesDe('.detalhe-bloco')).not.toMatch(/min-height/);
  });
});
