// A bandeira da Occupation acima do pre-save, em duas camadas.
//
// A arte original e silhueta PRETA sobre fundo BRANCO (1080x1350): uma pessoa
// segurando um mastro, a bandeira preta com o emblema branco e a palavra
// OCCUPATION em pe ao longo do mastro. O site e preto, entao a arte vira
// prata (--prata, a cor do P da barra e do texto da home) sobre transparente:
// o alpha sai do escuro de cada pixel. O emblema, que era branco sobre o
// tecido preto, fica vazado no tecido prata — o preto da pagina aparece por
// ele, e ele continua legivel.
//
// Duas camadas, para so o tecido mexer:
//
//   figura  pessoa, mastro abaixo do tecido e OCCUPATION. Parada.
//   pano    o tecido com o emblema, desvirado: o lado preso ao mastro fica
//           vertical, na borda direita da imagem. A home gira a camada de
//           volta e fatia em tiras verticais, paralelas ao mastro.
//
// O que separa o tecido do resto e uma reta paralela ao mastro, entre a borda
// do tecido e as letras de OCCUPATION (medida na arte: a borda do tecido anda
// 0,41 px para a esquerda a cada px para baixo, e as letras ficam de 9 a 17 px
// a direita dela), e uma linha horizontal onde o tecido termina no mastro.

import sharp from 'sharp';

/** Cor da arte: --prata (#cdd0d5). */
const PRATA = [0xcd, 0xd0, 0xd5];

/** Reta que separa o tecido: x = RETA_X0 - RETA_INCLINACAO * (y - RETA_Y0), px da arte. */
const RETA_X0 = 744;
const RETA_Y0 = 330;
const RETA_INCLINACAO = 0.41;
/** Abaixo desta linha (px da arte) e mastro e pessoa, nada de tecido. */
const TECIDO_ATE_Y = 546;

/** Saida: px da imagem por px da arte. A bandeira aparece com ate ~240 px de altura: 2x. */
const ESCALA = 0.5;
/** Folga do pano, em px da arte, para a onda nao sair da imagem. */
const FOLGA = 24;

const OPCOES_WEBP = { quality: 88, alphaQuality: 100, exact: true, effort: 6 };

/** Angulo do mastro com a vertical, em graus. */
const ANGULO = (Math.atan(RETA_INCLINACAO) * 180) / Math.PI;

const sen = Math.sin((ANGULO * Math.PI) / 180);
const cos = Math.cos((ANGULO * Math.PI) / 180);
/** Ao longo do mastro, para baixo. */
const U = [-sen, cos];
/** Perpendicular ao mastro, para dentro do tecido. */
const V = [-cos, -sen];

const ehTecido = (x, y) => y < TECIDO_ATE_Y && x < RETA_X0 - RETA_INCLINACAO * (y - RETA_Y0);

/** Alpha 0..1 a partir do cinza: o branco some, o preto fica inteiro. */
function alphas(cinza) {
  const a = new Float32Array(cinza.length);
  for (let i = 0; i < cinza.length; i++) {
    a[i] = Math.min(1, Math.max(0, (1 - cinza[i] / 255 - 0.04) / 0.92));
  }
  return a;
}

/** RGBA prata com o alpha dado, para o sharp. */
function rgba(alpha, largura, altura) {
  const saida = Buffer.alloc(largura * altura * 4);
  for (let i = 0; i < largura * altura; i++) {
    saida[i * 4] = PRATA[0];
    saida[i * 4 + 1] = PRATA[1];
    saida[i * 4 + 2] = PRATA[2];
    saida[i * 4 + 3] = Math.round(alpha[i] * 255);
  }
  return sharp(saida, { raw: { width: largura, height: altura, channels: 4 } });
}

/**
 * @param {Buffer} original a arte em PNG/JPG, preto sobre branco
 * @returns {Promise<{ figura: Buffer, pano: Buffer, geometria: object }>}
 */
export async function separa(original) {
  const { data, info } = await sharp(original)
    .flatten({ background: '#ffffff' })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const L = info.width;
  const A = info.height;
  const alpha = alphas(data);

  // Caixa de tudo que tem tinta, com margem: e o recorte da figura.
  let x0 = L;
  let y0 = A;
  let x1 = 0;
  let y1 = 0;
  for (let y = 0; y < A; y++) {
    for (let x = 0; x < L; x++) {
      if (alpha[y * L + x] <= 0) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  const M = FOLGA;
  x0 = Math.max(0, x0 - M);
  y0 = Math.max(0, y0 - M);
  x1 = Math.min(L - 1, x1 + M);
  y1 = Math.min(A - 1, y1 + M);
  // Lados pares na saida, para os percentuais fecharem.
  const largura = Math.round(((x1 - x0 + 1) * ESCALA) / 2) * 2;
  const altura = Math.round(((y1 - y0 + 1) * ESCALA) / 2) * 2;
  const larguraArte = largura / ESCALA;
  const alturaArte = altura / ESCALA;

  // Tecido e figura, em px da arte.
  const tecido = new Float32Array(L * A);
  const figura = new Float32Array(L * A);
  let u0 = Infinity;
  let u1 = -Infinity;
  let v1 = 0;
  for (let y = 0; y < A; y++) {
    for (let x = 0; x < L; x++) {
      const i = y * L + x;
      if (!ehTecido(x, y)) {
        figura[i] = alpha[i];
        continue;
      }
      tecido[i] = alpha[i];
      if (alpha[i] <= 0) continue;
      const dx = x + 0.5 - RETA_X0;
      const dy = y + 0.5 - RETA_Y0;
      const u = dx * U[0] + dy * U[1];
      const v = dx * V[0] + dy * V[1];
      if (u < u0) u0 = u;
      if (u > u1) u1 = u;
      if (v > v1) v1 = v;
    }
  }

  const figuraRecortada = new Float32Array(larguraArte * alturaArte);
  for (let y = 0; y < alturaArte; y++) {
    for (let x = 0; x < larguraArte; x++) {
      const sx = x + x0;
      const sy = y + y0;
      if (sx < L && sy < A) figuraRecortada[y * larguraArte + x] = figura[sy * L + sx];
    }
  }

  // O pano desvirado: borda direita = a reta do mastro, de cima para baixo.
  const uTopo = Math.floor(u0) - M;
  const panoAltArte = Math.ceil(u1 - uTopo) + M;
  const panoLargArte = Math.ceil(v1) + M;
  const panoLarg = Math.round((panoLargArte * ESCALA) / 2) * 2;
  const panoAlt = Math.round((panoAltArte * ESCALA) / 2) * 2;
  // Amostra 2x2 por pixel de saida, bilinear na arte.
  const amostra = (x, y) => {
    const xf = Math.floor(x);
    const yf = Math.floor(y);
    if (xf < 0 || yf < 0 || xf + 1 >= L || yf + 1 >= A) return 0;
    const fx = x - xf;
    const fy = y - yf;
    const i = yf * L + xf;
    return (
      tecido[i] * (1 - fx) * (1 - fy) +
      tecido[i + 1] * fx * (1 - fy) +
      tecido[i + L] * (1 - fx) * fy +
      tecido[i + L + 1] * fx * fy
    );
  };
  const pano = new Float32Array(panoLarg * panoAlt);
  const passo = 1 / ESCALA;
  for (let py = 0; py < panoAlt; py++) {
    for (let px = 0; px < panoLarg; px++) {
      let soma = 0;
      for (const oy of [0.25, 0.75]) {
        for (const ox of [0.25, 0.75]) {
          const v = (panoLarg - (px + ox)) * passo;
          const u = uTopo + (py + oy) * passo;
          soma += amostra(RETA_X0 + u * U[0] + v * V[0] - 0.5, RETA_Y0 + u * U[1] + v * V[1] - 0.5);
        }
      }
      pano[py * panoLarg + px] = soma / 4;
    }
  }

  // Canto de cima a direita do pano, na arte: e o eixo da rotacao na home.
  const canto = [RETA_X0 + uTopo * U[0], RETA_Y0 + uTopo * U[1]];
  const larguraPanoArte = panoLarg / ESCALA;
  const alturaPanoArte = panoAlt / ESCALA;
  const pct = (n) => Math.round(n * 10000) / 100;
  const geometria = {
    figura: { largura, altura },
    pano: {
      largura: panoLarg,
      altura: panoAlt,
      // Em % da figura, antes de girar; o giro e em torno do canto de cima a direita.
      esquerda: pct((canto[0] - larguraPanoArte - x0) / larguraArte),
      topo: pct((canto[1] - y0) / alturaArte),
      larguraPct: pct(larguraPanoArte / larguraArte),
      alturaPct: pct(alturaPanoArte / alturaArte),
      angulo: Math.round(ANGULO * 100) / 100,
    },
  };

  const figuraWebp = await rgba(figuraRecortada, larguraArte, alturaArte)
    .resize(largura, altura, { kernel: 'lanczos3' })
    .webp(OPCOES_WEBP)
    .toBuffer();
  const panoWebp = await rgba(pano, panoLarg, panoAlt).webp(OPCOES_WEBP).toBuffer();

  return { figura: figuraWebp, pano: panoWebp, geometria };
}
