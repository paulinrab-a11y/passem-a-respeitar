import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LANCAMENTO } from './lancamento';

const MESES = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

/**
 * A data de lancamento (#269). Uma constante, duas formas, e os documentos
 * do repositorio dizendo a mesma coisa: se alguem mudar so um lado, cai aqui.
 */
describe('a data de lancamento', () => {
  const [dia, mes, ano] = LANCAMENTO.curto.split('.');

  it('a forma curta e a por extenso sao a mesma data', () => {
    expect(LANCAMENTO.curto).toMatch(/^\d{2}\.\d{2}\.\d{4}$/);
    expect(LANCAMENTO.porExtenso).toBe(`${Number(dia)} de ${MESES[Number(mes) - 1]} de ${ano}`);
  });

  it('bate com o AGENTS.md, que e a fonte da verdade', () => {
    expect(readFileSync('AGENTS.md', 'utf8')).toContain(`Lançamento ${dia}/${mes}/${ano}.`);
  });

  it('bate com o README', () => {
    expect(readFileSync('README.md', 'utf8')).toContain(`Lançamento **${LANCAMENTO.curto}**`);
  });
});
