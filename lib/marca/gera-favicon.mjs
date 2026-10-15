// Grava app/favicon.ico a partir de public/brasao.svg (#318).
//
//   npm run favicon:gera              escreve o arquivo
//   npm run favicon:gera -- --confere so compara com o que esta no disco
//
// Quem mudar o brasao roda isto de novo. O .ico nao se edita na mao.

import { readFile, writeFile } from 'node:fs/promises';
import { geraFavicon } from './favicon.mjs';

const DESTINO = new URL('../../app/favicon.ico', import.meta.url);

const novo = await geraFavicon();

if (process.argv.includes('--confere')) {
  const noDisco = await readFile(DESTINO).catch(() => Buffer.alloc(0));
  if (!noDisco.equals(novo)) {
    console.error('app/favicon.ico difere do que o brasao gera: rode npm run favicon:gera');
    process.exit(1);
  }
  console.log('app/favicon.ico confere');
} else {
  await writeFile(DESTINO, novo);
  console.log(`escrito: app/favicon.ico (${novo.length} bytes)`);
}
