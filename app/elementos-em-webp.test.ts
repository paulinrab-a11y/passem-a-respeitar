import { createHash } from 'node:crypto';
import { existsSync, readdirSync, statSync } from 'node:fs';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { CONFIG } from './_home/config';

/**
 * Elementos cromados em WebP (#145, #166).
 *
 * O shader da home tira o branco pela cor do pixel e le a textura com filtro
 * linear: na borda do objeto, a cor de um pixel TRANSPARENTE entra na conta
 * do vizinho. Compressao com perda mexe justamente ali, e um conversor que
 * zere a cor dos transparentes tambem — a borda ganharia um halo.
 *
 * Por isso a conversao foi sem perda e preservando a cor dos transparentes.
 * Enquanto os PNGs estavam no repositorio, este teste comparava os dois
 * arquivos byte a byte. Os PNGs sairam na #166, depois de a igualdade ser
 * conferida tambem dentro do navegador, e o que ficou aqui e a impressao
 * digital dos pixels DELES: se alguem trocar um WebP por uma versao com
 * perda, ou recomprimida por outra ferramenta, a impressao nao bate.
 */

/** Tamanho, SHA-256 dos pixels decodificados (RGBA) e peso do PNG original. */
const ORIGINAIS: Record<string, { lado: number; pixels: string; pngBytes: number }> = {
  corrente: {
    lado: 1600,
    pixels: '809b8bf53cd9ad7d8cca7932897a4c63867d0681385eb670b993ae4625c8efca',
    pngBytes: 1_041_105,
  },
  mao: {
    lado: 1600,
    pixels: 'efec64755c7db921be7e85537270c47b77c463f8c793c175f1b6b99267106d19',
    pngBytes: 561_205,
  },
  saturno: {
    lado: 1600,
    pixels: 'c16479efb03ed896035d4fb9316f3199531e90c93a6920618085f806c51cb877',
    pngBytes: 820_200,
  },
  p: {
    lado: 2000,
    pixels: '3dcdfe2a5c305d12aa52d3465cfaa65ca0eaf471cc8f16f04ad41e9fed31f1fb',
    pngBytes: 1_205_008,
  },
  pistola: {
    lado: 1600,
    pixels: '64bfb533e0753a8ab91666aa96a7a079e1ed97f339eb280ec4448a7665d19dd4',
    pngBytes: 1_344_406,
  },
};

const pasta = (url: string) => `public${url}`;

async function pixels(arquivo: string) {
  const { data, info } = await sharp(arquivo).raw().toBuffer({ resolveWithObject: true });
  return { data, largura: info.width, altura: info.height, canais: info.channels };
}

const impressao = (dados: Buffer) => createHash('sha256').update(dados).digest('hex');

describe('configuracao', () => {
  it('sao cinco elementos, os mesmos cinco', () => {
    expect(CONFIG.elementos.map((e) => e.nome).sort()).toEqual(Object.keys(ORIGINAIS).sort());
  });

  it.each(CONFIG.elementos)('$nome: WebP, servido pela propria origem', (e) => {
    expect(e.url).toBe(`/elementos/${e.nome}.webp`);
    expect(existsSync(pasta(e.url))).toBe(true);
  });

  it('nenhum elemento aponta reserva para arquivo que nao existe', () => {
    for (const e of CONFIG.elementos) {
      if (e.fallback) expect(existsSync(pasta(e.fallback)), e.fallback).toBe(true);
    }
  });

  it('a pasta so tem o que a home usa', () => {
    expect(readdirSync('public/elementos').sort()).toEqual(
      CONFIG.elementos.map((e) => `${e.nome}.webp`).sort()
    );
  });
});

describe('os pixels dos originais', () => {
  it.each(CONFIG.elementos)(
    '$nome: o WebP decodifica para os pixels do PNG original',
    async (e) => {
      const original = ORIGINAIS[e.nome];
      const webp = await pixels(pasta(e.url));

      expect(webp.largura).toBe(original.lado);
      expect(webp.altura).toBe(original.lado);
      // Alpha preservado.
      expect(webp.canais).toBe(4);
      // Todos os bytes, o que inclui a cor dos pixels com alpha zero.
      expect(impressao(webp.data)).toBe(original.pixels);
    },
    60_000
  );

  it('a impressao enxerga diferenca: um bit trocado muda tudo', async () => {
    const { data } = await pixels(pasta(CONFIG.elementos[0].url));
    const mexido = Buffer.from(data);
    mexido[0] ^= 1;

    expect(impressao(mexido)).not.toBe(impressao(data));
  });
});

describe('peso', () => {
  it.each(CONFIG.elementos)('$nome: o WebP pesa no maximo 65% do PNG original', (e) => {
    expect(statSync(pasta(e.url)).size / ORIGINAIS[e.nome].pngBytes).toBeLessThanOrEqual(0.65);
  });

  it('os cinco juntos pesam menos de 2,7 MB', () => {
    const total = CONFIG.elementos.reduce((s, e) => s + statSync(pasta(e.url)).size, 0);

    expect(total).toBeLessThan(2.7 * 1024 * 1024);
  });
});
