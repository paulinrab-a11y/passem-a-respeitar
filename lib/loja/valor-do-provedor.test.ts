import { describe, expect, it } from 'vitest';
import { valorParaApi } from './orders-api';
import { centavosDaApi, moedaDaApi, valorConfere } from './valor-do-provedor';

describe('centavosDaApi', () => {
  it.each([
    ['14.38', 1438],
    ['14.4', 1440],
    ['14', 1400],
    ['0.01', 1],
    [' 129.00 ', 12900],
    [14.38, 1438],
    [129, 12900],
  ])('%o vira %i, sem float', (entrada, centavos) => {
    expect(centavosDaApi(entrada)).toBe(centavos);
  });

  it.each(['-14.38', '14,38', '14.385', '1e3', '', 'abc', '14.', null, undefined, {}])(
    '%o nao se le',
    (entrada) => {
      expect(centavosDaApi(entrada)).toBeNull();
    }
  );

  // A volta tem que desfazer a ida: o que o checkout manda e o que se confere.
  it('desfaz valorParaApi para todo valor de 1 centavo a 10 mil reais', () => {
    for (let c = 1; c <= 1_000_000; c += 997) {
      expect(centavosDaApi(valorParaApi(c))).toBe(c);
    }
  });
});

describe('moedaDaApi', () => {
  it('normaliza e trata vazio como ausente', () => {
    expect(moedaDaApi('brl')).toBe('BRL');
    expect(moedaDaApi('')).toBeNull();
    expect(moedaDaApi(undefined)).toBeNull();
  });
});

describe('valorConfere', () => {
  const certo = { totalCentavos: 12900, pagoCentavos: 12900, moeda: 'BRL' };

  it('total, pago e moeda iguais conferem', () => {
    expect(valorConfere(certo, 12900)).toBe(true);
  });

  it('sem pago nem moeda, vale o total', () => {
    expect(valorConfere({ totalCentavos: 12900, pagoCentavos: null, moeda: null }, 12900)).toBe(
      true
    );
  });

  it.each([
    ['total diferente', { ...certo, totalCentavos: 100 }],
    ['pago parcial', { ...certo, pagoCentavos: 100 }],
    ['outra moeda', { ...certo, moeda: 'USD' }],
    ['sem total', { ...certo, totalCentavos: null }],
  ])('%s nao confere', (_caso, valor) => {
    expect(valorConfere(valor, 12900)).toBe(false);
  });

  it('sem nenhuma informacao de valor nao confere', () => {
    expect(valorConfere(undefined, 12900)).toBe(false);
  });
});
