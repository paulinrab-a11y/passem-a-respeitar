// favicon.ico do brasao (#318).
//
// O favicon principal e app/icon.svg: o brasao sem fundo, preto em aba clara e
// branco em aba escura (decisao do dono no #223). O .ico existe para quem nao
// le favicon SVG (Safari antigo) e para quem pede /favicon.ico direto
// (buscador, leitor de RSS). Ele nao tem media query, entao sai igual ao que o
// SVG mostra sem ela: brasao preto, sem fundo.
//
// A silhueta vem de public/brasao.svg, so trocando a cor. O recorte e o mesmo
// do icon.svg: o brasao centralizado num quadrado, sem esticar.

import { readFile } from 'node:fs/promises';
import sharp from 'sharp';

/** Tamanhos dentro do .ico. O Next poe o maior (48) no `sizes` do link. */
export const TAMANHOS = [32, 16, 48];

const BRASAO = new URL('../../public/brasao.svg', import.meta.url);

/** @returns {Promise<string>} o brasao em preto */
export async function brasaoPreto() {
  const svg = await readFile(BRASAO, 'utf8');
  const preto = svg.replace('fill="#fff"', 'fill="#000"');
  if (preto === svg) throw new Error('public/brasao.svg mudou: nao achei fill="#fff"');
  return preto;
}

/**
 * Brasao num quadrado transparente de `tamanho` px, em PNG.
 * @param {string} svg
 * @param {number} tamanho
 */
export function renderiza(svg, tamanho) {
  return sharp(Buffer.from(svg))
    .resize(tamanho, tamanho, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/**
 * Monta um .ico com PNG dentro de cada entrada (formato aceito desde o
 * Windows Vista e por todo navegador atual).
 * @param {{ tamanho: number, png: Buffer }[]} imagens
 */
export function montaIco(imagens) {
  const cabecalho = Buffer.alloc(6);
  cabecalho.writeUInt16LE(0, 0); // reservado
  cabecalho.writeUInt16LE(1, 2); // 1 = icone
  cabecalho.writeUInt16LE(imagens.length, 4);

  let deslocamento = 6 + 16 * imagens.length;
  const entradas = imagens.map(({ tamanho, png }) => {
    if (tamanho < 1 || tamanho > 256) throw new Error(`tamanho fora do .ico: ${tamanho}`);
    const e = Buffer.alloc(16);
    e.writeUInt8(tamanho === 256 ? 0 : tamanho, 0); // largura (0 = 256)
    e.writeUInt8(tamanho === 256 ? 0 : tamanho, 1); // altura
    e.writeUInt8(0, 2); // paleta
    e.writeUInt8(0, 3); // reservado
    e.writeUInt16LE(1, 4); // planos
    e.writeUInt16LE(32, 6); // bits por pixel
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(deslocamento, 12);
    deslocamento += png.length;
    return e;
  });

  return Buffer.concat([cabecalho, ...entradas, ...imagens.map((i) => i.png)]);
}

/**
 * Le de volta as entradas de um .ico montado por `montaIco`.
 * @param {Buffer} ico
 * @returns {{ tamanho: number, png: Buffer }[]}
 */
export function leIco(ico) {
  if (ico.readUInt16LE(0) !== 0 || ico.readUInt16LE(2) !== 1) throw new Error('nao e um .ico');
  const total = ico.readUInt16LE(4);
  return Array.from({ length: total }, (_, i) => {
    const base = 6 + 16 * i;
    const tamanho = ico.readUInt8(base) || 256;
    const bytes = ico.readUInt32LE(base + 8);
    const inicio = ico.readUInt32LE(base + 12);
    return { tamanho, png: ico.subarray(inicio, inicio + bytes) };
  });
}

/** O .ico completo, a partir do public/brasao.svg. */
export async function geraFavicon() {
  const svg = await brasaoPreto();
  const imagens = await Promise.all(
    TAMANHOS.map(async (tamanho) => ({ tamanho, png: await renderiza(svg, tamanho) }))
  );
  return montaIco(imagens);
}
