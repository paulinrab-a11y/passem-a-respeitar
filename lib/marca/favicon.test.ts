import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { brasaoPreto, leIco, montaIco, renderiza, TAMANHOS } from './favicon.mjs';

// #318: app/favicon.ico e saida de lib/marca/gera-favicon.mjs. O que se
// confere aqui e o arquivo que vai para o ar: formato, tamanhos, cor e a
// silhueta igual ao vetor do brasao.

const ICO = readFileSync(new URL('../../app/favicon.ico', import.meta.url));
const PNG = [0x89, 0x50, 0x4e, 0x47];

async function pixels(png: Buffer) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, largura: info.width, altura: info.height };
}

describe('app/favicon.ico', () => {
  const entradas = leIco(ICO);

  it('tem 32, 16 e 48 px, nessa ordem (o Next declara o primeiro no sizes)', () => {
    expect(entradas.map((e) => e.tamanho)).toEqual([32, 16, 48]);
    expect(TAMANHOS).toEqual([32, 16, 48]);
  });

  it.each(TAMANHOS)('a entrada de %i px e um PNG quadrado desse tamanho', async (tamanho) => {
    const { png } = entradas.find((e) => e.tamanho === tamanho) ?? { png: Buffer.alloc(0) };
    expect([...png.subarray(0, 4)]).toEqual(PNG);
    const { largura, altura } = await pixels(png);
    expect([largura, altura]).toEqual([tamanho, tamanho]);
  });

  it.each(TAMANHOS)('em %i px o brasao e preto e sem fundo', async (tamanho) => {
    const { png } = entradas.find((e) => e.tamanho === tamanho) ?? { png: Buffer.alloc(0) };
    const { data } = await pixels(png);
    let opacos = 0;
    for (let i = 0; i < data.length; i += 4) {
      const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
      if (a === 0) continue;
      opacos++;
      expect(Math.max(r, g, b)).toBeLessThan(16);
    }
    // Os quatro cantos ficam fora do brasao: sem quadrado de fundo.
    const ultimo = tamanho * tamanho - 1;
    for (const p of [0, tamanho - 1, ultimo - (tamanho - 1), ultimo]) {
      expect(data[p * 4 + 3]).toBe(0);
    }
    expect(opacos).toBeGreaterThan(tamanho * tamanho * 0.2);
  });

  it('a silhueta de 48 px bate com o public/brasao.svg renderizado agora', async () => {
    const atual = await pixels(entradas.find((e) => e.tamanho === 48)?.png ?? Buffer.alloc(0));
    const vetor = await pixels(await renderiza(await brasaoPreto(), 48));
    let diferenca = 0;
    for (let i = 3; i < atual.data.length; i += 4) {
      diferenca += Math.abs(atual.data[i] - vetor.data[i]);
    }
    // Alfa medio quase identico: so sobra diferenca de arredondamento entre
    // builds do libvips. Brasao trocado ou esticado passa longe disso.
    expect(diferenca / (48 * 48)).toBeLessThan(2);
  });
});

describe('montaIco', () => {
  it('le de volta o que escreveu, com 256 px gravado como 0', () => {
    const a = Buffer.from([1, 2, 3]);
    const b = Buffer.from([4, 5]);
    const ico = montaIco([
      { tamanho: 16, png: a },
      { tamanho: 256, png: b },
    ]);
    expect(ico.readUInt8(6 + 16)).toBe(0);
    expect(leIco(ico)).toEqual([
      { tamanho: 16, png: a },
      { tamanho: 256, png: b },
    ]);
  });

  it('recusa tamanho que o .ico nao guarda', () => {
    expect(() => montaIco([{ tamanho: 512, png: Buffer.alloc(1) }])).toThrow(/512/);
  });
});
