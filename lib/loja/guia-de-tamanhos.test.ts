import { describe, expect, it } from 'vitest';
import { leGuia } from './guia-de-tamanhos';

const MIKONOS = [
  { tamanho: 'P', altura: 79, largura: 67, manga: 23 },
  { tamanho: 'M', altura: 80, largura: 69, manga: 24 },
  { tamanho: 'G', altura: 82, largura: 72, manga: 25 },
  { tamanho: 'GG', altura: 84, largura: 74, manga: 26 },
];

describe('leGuia (#206)', () => {
  it('le a tabela da Mikonos como esta no banco', () => {
    expect(leGuia(MIKONOS)).toEqual(MIKONOS);
  });

  it('produto sem guia e null, e a tela nao mostra o link', () => {
    expect(leGuia(null)).toBeNull();
    expect(leGuia(undefined)).toBeNull();
  });

  it.each([
    ['lista vazia', []],
    ['objeto no lugar de lista', { P: 79 }],
    ['medida em texto', [{ tamanho: 'P', altura: '79', largura: 67, manga: 23 }]],
    ['medida quebrada', [{ tamanho: 'P', altura: 79.5, largura: 67, manga: 23 }]],
    ['medida absurda', [{ tamanho: 'P', altura: 790, largura: 67, manga: 23 }]],
    ['sem manga', [{ tamanho: 'P', altura: 79, largura: 67 }]],
    ['tamanho vazio', [{ tamanho: '', altura: 79, largura: 67, manga: 23 }]],
  ])('%s: o guia inteiro e null, e nao uma tabela pela metade', (_, bruto) => {
    expect(leGuia(bruto)).toBeNull();
  });

  it('uma linha torta derruba as certas junto', () => {
    expect(leGuia([...MIKONOS, { tamanho: 'EXG', altura: 'grande' }])).toBeNull();
  });

  it('chave que o banco nao conhece sai, sem derrubar', () => {
    const [p] = leGuia([{ ...MIKONOS[0], cor: 'preta' }]) ?? [];
    expect(p).toEqual(MIKONOS[0]);
  });
});
