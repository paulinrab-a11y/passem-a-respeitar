import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PRAZO_DE_PRODUCAO_DIAS } from './prazo';

/**
 * O prazo de producao (#197) num lugar so (#278). O que se prova aqui e que
 * nenhum texto voltou a escrever o numero a mao: quem quiser mudar o prazo
 * muda a constante, e a ficha, o checkout e o concierge mudam juntos.
 */

const TEXTOS = [
  'app/page.tsx',
  'app/checkout/page.tsx',
  'app/checkout/Entrega.tsx',
  'lib/concierge/prompt.ts',
];

describe('PRAZO_DE_PRODUCAO_DIAS', () => {
  it('e um numero inteiro de dias', () => {
    expect(Number.isInteger(PRAZO_DE_PRODUCAO_DIAS)).toBe(true);
    expect(PRAZO_DE_PRODUCAO_DIAS).toBeGreaterThan(0);
  });

  it.each(TEXTOS)('%s usa a constante, e nao o numero escrito', (arquivo) => {
    const codigo = readFileSync(arquivo, 'utf8');
    expect(codigo).toContain('PRAZO_DE_PRODUCAO_DIAS');
    expect(codigo).not.toMatch(/pelo menos \d+ dias/);
  });
});
