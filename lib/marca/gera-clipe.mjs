// Grava public/clipe/* a partir do teaser do Blick que o dono mandou.
//
//   npm run clipe:gera -- "C:\caminho\TEASER BLICK FINALIZADO.mp4"
//   CLIPE_ORIGEM="/caminho/teaser.mp4" npm run clipe:gera
//
// O original (HEVC 1920x1080, 30 fps, AAC estereo) nao entra no repositorio:
// e grande, e HEVC nao toca em boa parte dos navegadores. Daqui saem:
//
//   blick-teaser-1080.mp4    H.264 high, yuv420p, CRF 23, AAC 128k   (#clipe, tela grande)
//   blick-teaser-720.mp4     o mesmo em 720p, CRF 24                  (#clipe, tela pequena)
//   blick-teaser-poster.webp o quadro de capa do player, 1280x720
//   blick-canto.mp4          320x180, 15 fps, sem audio, CRF alto     (o canto VHS do topo)
//   blick-canto-poster.webp  o mesmo quadro, 320x180                  (canto parado)
//
// `+faststart` poe o indice no comeco do arquivo: o player comeca a tocar
// antes do download terminar. `-map_metadata -1` tira do arquivo o nome do
// projeto, o software e as datas que o editor grava.
//
// Precisa do ffmpeg no PATH (com libx264). A saida nao e byte a byte igual
// entre versoes do ffmpeg; por isso nao ha `--confere`, como ha nos elementos.

import { execFileSync } from 'node:child_process';
import { mkdirSync, statSync } from 'node:fs';
import sharp from 'sharp';

const origem = process.argv[2] || process.env.CLIPE_ORIGEM;
if (!origem) {
  console.error('uso: npm run clipe:gera -- "<caminho do teaser .mp4>"  (ou CLIPE_ORIGEM=...)');
  process.exit(1);
}

const PASTA = new URL('../../public/clipe/', import.meta.url);
mkdirSync(PASTA, { recursive: true });
const destino = (nome) =>
  decodeURIComponent(new URL(nome, PASTA).pathname).replace(/^\/([A-Za-z]:)/, '$1');

/** O quadro da capa: o Blick de frente, gesto para a camera. Nem preto, nem a cartela final. */
const CAPA_EM_SEGUNDOS = '5';
/** O trecho do canto: so filmagem, sem o preto do comeco e sem a cartela do fim. */
const CANTO_DE = '1.5';
const CANTO_ATE = '18.5';

const ffmpeg = (args) =>
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
    stdio: ['ignore', 'pipe', 'inherit'],
    maxBuffer: 64 * 1024 * 1024,
  });

const H264 = ['-c:v', 'libx264', '-preset', 'slow', '-profile:v', 'high', '-pix_fmt', 'yuv420p'];
const COMUM = ['-map_metadata', '-1', '-movflags', '+faststart'];

function video(nome, filtro, crf) {
  ffmpeg([
    '-i',
    origem,
    '-vf',
    filtro,
    ...H264,
    '-crf',
    String(crf),
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-ac',
    '2',
    ...COMUM,
    destino(nome),
  ]);
}

function canto(nome) {
  ffmpeg([
    '-ss',
    CANTO_DE,
    '-to',
    CANTO_ATE,
    '-i',
    origem,
    '-vf',
    'scale=320:180:flags=lanczos,fps=15',
    ...H264,
    '-crf',
    '33',
    '-g',
    '30',
    '-an',
    ...COMUM,
    destino(nome),
  ]);
}

async function capa(nome, largura, qualidade) {
  const png = ffmpeg([
    '-ss',
    CAPA_EM_SEGUNDOS,
    '-i',
    origem,
    '-frames:v',
    '1',
    '-vf',
    `scale=${largura}:-2:flags=lanczos`,
    '-f',
    'image2pipe',
    '-c:v',
    'png',
    '-',
  ]);
  await sharp(png).webp({ quality: qualidade, effort: 6 }).toFile(destino(nome));
}

video('blick-teaser-1080.mp4', 'scale=1920:-2:flags=lanczos', 23);
video('blick-teaser-720.mp4', 'scale=-2:720:flags=lanczos', 24);
canto('blick-canto.mp4');
await capa('blick-teaser-poster.webp', 1280, 78);
await capa('blick-canto-poster.webp', 320, 70);

for (const nome of [
  'blick-teaser-1080.mp4',
  'blick-teaser-720.mp4',
  'blick-teaser-poster.webp',
  'blick-canto.mp4',
  'blick-canto-poster.webp',
]) {
  console.log(
    `escrito: public/clipe/${nome} (${Math.round(statSync(destino(nome)).size / 1024)} KB)`
  );
}
