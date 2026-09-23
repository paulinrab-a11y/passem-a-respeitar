import 'server-only';

import sharp from 'sharp';

/**
 * Regras do unico upload do site (Issue #26).
 *
 * A ordem importa: tamanho, depois extensao, depois os bytes de verdade, e so
 * entao o sharp. Cada passo e mais caro que o anterior, e os baratos existem
 * para o caro nunca receber lixo.
 */

export const TAMANHO_MAX = 2 * 1024 * 1024;

const EXTENSOES = ['.jpg', '.jpeg', '.png', '.webp'];

/** 512 e o dobro do maior lugar onde a foto aparece, para tela retina. */
const LADO = 512;

type TipoReal = 'image/jpeg' | 'image/png' | 'image/webp';

/**
 * Tipo pelos primeiros bytes, nao pelo que o navegador declarou.
 *
 * O `Content-Type` do formulario e escolhido por quem envia. Um `.php`
 * renomeado para `.png` chega anunciando `image/png` com a maior cara de
 * inocente; os bytes nao mentem.
 *
 * SVG fica de fora de proposito, e nao por esquecimento: SVG e XML, aceita
 * `<script>` dentro, e servido na origem certa vira XSS.
 */
export function tipoRealDe(bytes: Uint8Array): TipoReal | null {
  const em = (i: number) => bytes[i];

  if (em(0) === 0xff && em(1) === 0xd8 && em(2) === 0xff) return 'image/jpeg';

  if (
    em(0) === 0x89 &&
    em(1) === 0x50 &&
    em(2) === 0x4e &&
    em(3) === 0x47 &&
    em(4) === 0x0d &&
    em(5) === 0x0a &&
    em(6) === 0x1a &&
    em(7) === 0x0a
  ) {
    return 'image/png';
  }

  // RIFF....WEBP
  const texto = (i: number, n: number) => String.fromCharCode(...Array.from(bytes.slice(i, i + n)));
  if (texto(0, 4) === 'RIFF' && texto(8, 4) === 'WEBP') return 'image/webp';

  return null;
}

export type Recusa = { ok: false; motivo: string };
export type Aceite = { ok: true; tipo: TipoReal };

/**
 * Mensagem util, nao generica: aqui o usuario e alguem logado mexendo na
 * propria foto, nao um desconhecido tentando adivinhar credencial. Dizer "o
 * arquivo tem 8 MB" nao entrega nada e evita a pessoa tentar cinco vezes sem
 * saber o que houve.
 */
export function validaFoto(arquivo: {
  nome: string;
  tamanho: number;
  bytes: Uint8Array;
}): Aceite | Recusa {
  if (arquivo.tamanho === 0) {
    return { ok: false, motivo: 'O arquivo chegou vazio.' };
  }

  if (arquivo.tamanho > TAMANHO_MAX) {
    const mb = (arquivo.tamanho / 1024 / 1024).toFixed(1);
    return { ok: false, motivo: `A imagem tem ${mb} MB. O limite é 2 MB.` };
  }

  const nome = arquivo.nome.toLowerCase();
  if (!EXTENSOES.some((e) => nome.endsWith(e))) {
    return { ok: false, motivo: 'Use uma imagem JPG, PNG ou WebP.' };
  }

  const tipo = tipoRealDe(arquivo.bytes);
  if (!tipo) {
    // Extensao certa e bytes de outra coisa: ou e engano, ou e tentativa.
    return { ok: false, motivo: 'Esse arquivo não é uma imagem JPG, PNG ou WebP.' };
  }

  return { ok: true, tipo };
}

/**
 * Reescreve a imagem em webp 512x512.
 *
 * Nao e so para economizar espaco. Reescrever joga fora tudo que nao for
 * pixel: o EXIF sai junto, e com ele a coordenada de GPS que a camera do
 * telefone grava sem avisar. Uma foto de perfil nao precisa contar onde a
 * pessoa mora.
 *
 * Tambem e a ultima checagem de que o arquivo e mesmo uma imagem: o sharp
 * recusa o que nao conseguir decodificar.
 */
export async function normalizaFoto(bytes: Uint8Array): Promise<Buffer> {
  return sharp(bytes, { failOn: 'error' })
    .rotate() // aplica a orientacao do EXIF antes de descarta-lo
    .resize(LADO, LADO, { fit: 'cover', position: 'attention' })
    .webp({ quality: 82 })
    .toBuffer();
}

/** Caminho no bucket. O nome original do arquivo e descartado. */
export function caminhoDaFoto(userId: string) {
  return `${userId}/${crypto.randomUUID()}.webp`;
}
