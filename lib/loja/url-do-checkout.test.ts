import { describe, expect, it } from 'vitest';
import { urlDoCheckout } from './url-do-checkout';

describe('urlDoCheckout (#356)', () => {
  it('produto e tamanho, como a ficha da home monta', () => {
    expect(urlDoCheckout('camiseta-cbac', 'M')).toBe('/checkout?p=camiseta-cbac&tam=M');
  });

  it('uma peca nao leva `q`; mais de uma leva', () => {
    expect(urlDoCheckout('camiseta-cbac', 'G', 1)).toBe('/checkout?p=camiseta-cbac&tam=G');
    expect(urlDoCheckout('camiseta-cbac', 'G', 3)).toBe('/checkout?p=camiseta-cbac&tam=G&q=3');
  });

  it('produto sem tamanho nao leva `tam`', () => {
    expect(urlDoCheckout('adesivo', null, 2)).toBe('/checkout?p=adesivo&q=2');
  });

  it('o que vem do banco e escapado, e nao vira outro parametro', () => {
    expect(urlDoCheckout('a&q=9', 'M')).toBe('/checkout?p=a%26q%3D9&tam=M');
  });
});
