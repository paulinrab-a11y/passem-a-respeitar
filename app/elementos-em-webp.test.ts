import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { LADO, NOMES, reexporta } from '@/lib/marca/elementos.mjs';
import { CONFIG } from './_home/config';

/**
 * Elementos cromados em WebP (#145, #166, #366).
 *
 * O shader da home tira o branco pela cor do pixel e le a textura com filtro
 * linear: na borda do objeto, a cor de um pixel TRANSPARENTE entra na conta
 * do vizinho. Nos originais essa cor e preta. Um conversor que a trocasse por
 * branco (ou por qualquer cor clara que comprima melhor) poria um halo na
 * borda.
 *
 * Ate a #366 os arquivos eram os originais sem perda, em 1600 e 2000 px, e o
 * teste guardava a impressao digital dos pixels deles. Agora sao 1024 px com
 * perda leve, gerados por lib/marca/gera-elementos.mjs a partir desses
 * originais (que ficam no historico do git). O que se confere:
 *
 *   - lado, alpha e a cor dos transparentes, que o shader exige;
 *   - a impressao digital do ARQUIVO: trocar um WebP sem passar pelo script
 *     (recomprimir em outra ferramenta, por exemplo) quebra o teste, e quem
 *     roda o script atualiza a tabela de proposito;
 *   - o peso.
 */

/** SHA-256 de cada arquivo em public/elementos, como o script grava. */
const ARQUIVOS: Record<string, string> = {
  corrente: 'f546fb598e256074e487d8cf902c8037b3633c22128b74501825cf89701307e8',
  mao: '4f61eca96a196451215545d4ee402b5ddd0cf3cf8314d55409bff686ef570e43',
  saturno: '309347b9d6931fbf73a6848778fcc46b07dd5f84e2ae43abf55a0116b191ea8e',
  p: '1f889c72b797fa7d06c60889ce143acac3d74f9b37971e8d450017e388cf82c8',
  pistola: '90270b7f483bd64233fe2a448ede631ea5905cdc4adb6a06a75a2266d8ca3223',
};

const pasta = (url: string) => `public${url}`;

async function pixels(arquivo: string | Buffer) {
  const { data, info } = await sharp(arquivo).raw().toBuffer({ resolveWithObject: true });
  return { data, largura: info.width, altura: info.height, canais: info.channels };
}

const impressao = (dados: Buffer) => createHash('sha256').update(dados).digest('hex');

/** Dos pixels com alpha zero: quantos sao preto puro e quantos sao claros. */
function transparentes(data: Buffer) {
  let total = 0;
  let pretos = 0;
  let claros = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] !== 0) continue;
    total++;
    const menor = Math.min(data[i], data[i + 1], data[i + 2]);
    const maior = Math.max(data[i], data[i + 1], data[i + 2]);
    if (maior === 0) pretos++;
    // O shader comeca a apagar o branco em 0,90; claro aqui e bem antes disso.
    if (menor > 0.5 * 255) claros++;
  }
  return { total, pretos, claros };
}

describe('configuracao', () => {
  it('sao cinco elementos, os mesmos cinco', () => {
    expect(CONFIG.elementos.map((e) => e.nome).sort()).toEqual(Object.keys(ARQUIVOS).sort());
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

describe('os pixels', () => {
  it.each(CONFIG.elementos)(
    '$nome: quadrado de 1024 px, com alpha',
    async (e) => {
      const webp = await pixels(pasta(e.url));

      expect(webp.largura).toBe(LADO);
      expect(webp.altura).toBe(LADO);
      expect(webp.canais).toBe(4);
    },
    60_000
  );

  // Nos originais, 99,9 % dos transparentes sao preto puro e nenhum e claro.
  // A perda leve mexe em alguns perto da borda, sempre para cores escuras.
  it.each(CONFIG.elementos)(
    '$nome: os transparentes continuam pretos, sem cor clara para vazar na borda',
    async (e) => {
      const { data } = await pixels(pasta(e.url));
      const t = transparentes(data);

      expect(t.total).toBeGreaterThan(0);
      expect(t.claros).toBe(0);
      expect(t.pretos / t.total).toBeGreaterThan(0.95);
    },
    60_000
  );

  it.each(CONFIG.elementos)('$nome: e o arquivo que o script grava', (e) => {
    expect(impressao(readFileSync(pasta(e.url)))).toBe(ARQUIVOS[e.nome]);
  });

  it('o script cobre os mesmos cinco da configuracao', () => {
    expect([...NOMES].sort()).toEqual(CONFIG.elementos.map((e) => e.nome).sort());
  });

  // A conversao em si, numa imagem pequena feita aqui: transparente preto
  // continua preto, o alpha do opaco nao muda e o lado e o pedido.
  it('a conversao preserva alpha e transparentes', async () => {
    const lado = 64;
    const bruto = Buffer.alloc(lado * lado * 4);
    for (let y = 0; y < lado; y++) {
      for (let x = 0; x < lado; x++) {
        const i = (y * lado + x) * 4;
        if (x >= 16 && x < 48 && y >= 16 && y < 48)
          bruto.fill(200, i, i + 3).fill(255, i + 3, i + 4);
      }
    }
    const original = await sharp(bruto, { raw: { width: lado, height: lado, channels: 4 } })
      .png()
      .toBuffer();

    const saida = await pixels(await reexporta(original, 32));
    const t = transparentes(saida.data);

    expect(saida.largura).toBe(32);
    expect(saida.canais).toBe(4);
    expect(t.claros).toBe(0);
    // Centro do quadrado opaco: alpha cheio.
    expect(saida.data[(16 * 32 + 16) * 4 + 3]).toBe(255);
    // Canto: transparente.
    expect(saida.data[3]).toBe(0);
  });
});

describe('peso', () => {
  // Eram 1600 e 2000 px sem perda, de 280 a 720 KB cada (#145).
  it.each(CONFIG.elementos)('$nome: no maximo 120 KB', (e) => {
    expect(statSync(pasta(e.url)).size).toBeLessThanOrEqual(120 * 1024);
  });

  it('os cinco juntos pesam menos de 400 KB (eram 2,63 MB)', () => {
    const total = CONFIG.elementos.reduce((s, e) => s + statSync(pasta(e.url)).size, 0);

    expect(total).toBeLessThan(400 * 1024);
  });
});
