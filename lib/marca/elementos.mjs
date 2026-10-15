// Elementos cromados da home em 1024 px (#366).
//
// Os originais sao os WebP sem perda da #145 (os mesmos pixels dos PNGs que
// vieram do Drive), em 1600 px e 2000 px: 2,63 MB. Na tela, o plano de cada
// elemento passa pouco de 700 px de framebuffer em desktop 1x e fica abaixo
// de 400 px no celular. 1024 px com perda leve pesa um decimo.
//
// Duas coisas que o shader da home exige e que esta conversao preserva:
//
//   - o alpha. Vai sem perda (`alphaQuality: 100`): e ele que recorta o
//     objeto, e borda serrilhada aparece na hora.
//   - a cor dos pixels transparentes. O shader le a textura com filtro linear,
//     e na borda a cor do transparente vizinho entra na conta. Nos originais
//     ela e preta; o redimensionamento do sharp e pre-multiplicado (o
//     transparente sai preto) e `exact` impede o encoder de trocar essa cor
//     por outra que comprima melhor.

import sharp from 'sharp';

export const NOMES = ['corrente', 'mao', 'saturno', 'p', 'pistola'];

/** Lado, em px, de cada elemento (todos sao quadrados). */
export const LADO = 1024;

/**
 * Commit com os originais sem perda (#145). E de la que o script le, e nao da
 * pasta public/, para rodar de novo nunca recomprimir o que ja foi comprimido.
 */
export const COMMIT_DOS_ORIGINAIS = '42518cf';

const OPCOES_WEBP = {
  quality: 85,
  alphaQuality: 100,
  exact: true,
  smartSubsample: true,
  effort: 6,
};

/**
 * @param {Buffer} original imagem quadrada, com alpha
 * @param {number} [lado]
 * @returns {Promise<Buffer>} o WebP pronto para public/elementos
 */
export async function reexporta(original, lado = LADO) {
  return sharp(original).resize(lado, lado, { kernel: 'lanczos3' }).webp(OPCOES_WEBP).toBuffer();
}
