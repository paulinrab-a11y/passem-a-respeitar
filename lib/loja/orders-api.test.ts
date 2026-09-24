import { describe, expect, it } from 'vitest';
import { valorParaApi } from './orders-api';

/**
 * O banco guarda centavos inteiros e a Orders API quer decimal em string. Esta
 * conversao e a unica ponte entre os dois, e errar nela e errar o valor da
 * cobranca — por isso ela vive num lugar so, e por isso tem teste.
 */
describe('valorParaApi', () => {
  it.each([
    [12000, '120.00'],
    [12990, '129.90'],
    [500, '5.00'],
    [1, '0.01'],
    [99, '0.99'],
    [10_000_000, '100000.00'],
  ])('%i centavos vira "%s"', (centavos, esperado) => {
    expect(valorParaApi(centavos)).toBe(esperado);
  });

  it('sempre tem duas casas, mesmo em valor redondo', () => {
    expect(valorParaApi(12000)).toMatch(/\.\d{2}$/);
  });

  // 3335 / 100 em binario nao e exatamente 33.35. Se a conversao um dia passar
  // por arredondamento proprio, e aqui que aparece.
  it('nao perde centavo em valor que nao fecha em binario', () => {
    expect(valorParaApi(3335)).toBe('33.35');
    expect(valorParaApi(1015)).toBe('10.15');
  });
});
