import { existsSync, statSync } from 'node:fs';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { CONFIG } from './_home/config';

/**
 * Elementos cromados em WebP (#145).
 *
 * O shader da home tira o branco pela cor do pixel e le a textura com filtro
 * linear: na borda do objeto, a cor de um pixel TRANSPARENTE entra na conta
 * do vizinho. Compressao com perda mexe justamente ali, e um conversor que
 * zere a cor dos transparentes tambem — a borda ganharia um halo.
 *
 * Por isso a conversao e sem perda e preserva a cor dos transparentes, e por
 * isso este teste nao confia nisso: decodifica os dois arquivos e compara.
 */

const pasta = (url: string) => `public${url}`;

async function pixels(arquivo: string) {
  const { data, info } = await sharp(arquivo).raw().toBuffer({ resolveWithObject: true });
  return { data, largura: info.width, altura: info.height, canais: info.channels };
}

describe('configuracao', () => {
  it('sao cinco elementos', () => {
    expect(CONFIG.elementos).toHaveLength(5);
  });

  it.each(CONFIG.elementos)('$nome: WebP na frente, PNG de reserva', (e) => {
    expect(e.url).toBe(`/elementos/${e.nome}.webp`);
    expect(e.fallback).toBe(`/elementos/${e.nome}.png`);
    expect(existsSync(pasta(e.url))).toBe(true);
    expect(existsSync(pasta(e.fallback ?? ''))).toBe(true);
  });
});

describe('os mesmos pixels', () => {
  it.each(CONFIG.elementos)(
    '$nome: o WebP decodifica para os bytes do PNG',
    async (e) => {
      const png = await pixels(pasta(e.fallback ?? ''));
      const webp = await pixels(pasta(e.url));

      expect(webp.largura).toBe(png.largura);
      expect(webp.altura).toBe(png.altura);
      // Alpha preservado: quatro canais nos dois.
      expect(png.canais).toBe(4);
      expect(webp.canais).toBe(4);
      // Byte a byte, o que inclui a cor dos pixels com alpha zero.
      expect(webp.data.equals(png.data)).toBe(true);
    },
    60_000
  );

  it('a comparacao enxerga diferenca: um byte trocado reprova', async () => {
    const { data } = await pixels(pasta(CONFIG.elementos[0].url));
    const mexido = Buffer.from(data);
    mexido[0] ^= 1;

    expect(mexido.equals(data)).toBe(false);
  });
});

describe('peso', () => {
  it.each(CONFIG.elementos)('$nome: o WebP pesa no maximo 65% do PNG', (e) => {
    const webp = statSync(pasta(e.url)).size;
    const png = statSync(pasta(e.fallback ?? '')).size;

    expect(webp / png).toBeLessThanOrEqual(0.65);
  });

  it('os cinco juntos pesam menos de 2,7 MB', () => {
    const total = CONFIG.elementos.reduce((s, e) => s + statSync(pasta(e.url)).size, 0);

    expect(total).toBeLessThan(2.7 * 1024 * 1024);
  });
});
