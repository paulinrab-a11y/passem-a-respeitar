// Grava public/elementos/*.webp a partir dos originais sem perda (#366).
//
//   npm run elementos:gera              escreve os cinco arquivos
//   npm run elementos:gera -- --confere so compara com o que esta no disco
//
// Os originais saem do historico do git (COMMIT_DOS_ORIGINAIS em
// elementos.mjs), entao o clone precisa ter esse commit: `git fetch --unshallow`
// se o clone for raso. Quem trocar um elemento poe o original novo num commit,
// aponta COMMIT_DOS_ORIGINAIS para ele e roda isto de novo.

import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { COMMIT_DOS_ORIGINAIS, NOMES, reexporta } from './elementos.mjs';

const PASTA = new URL('../../public/elementos/', import.meta.url);
const confere = process.argv.includes('--confere');

let diferentes = 0;
for (const nome of NOMES) {
  const original = execFileSync(
    'git',
    ['show', `${COMMIT_DOS_ORIGINAIS}:public/elementos/${nome}.webp`],
    { maxBuffer: 32 * 1024 * 1024 }
  );
  const novo = await reexporta(original);
  const destino = new URL(`${nome}.webp`, PASTA);

  if (confere) {
    const noDisco = await readFile(destino).catch(() => Buffer.alloc(0));
    if (!noDisco.equals(novo)) {
      console.error(`public/elementos/${nome}.webp difere do que o original gera`);
      diferentes++;
    }
  } else {
    await writeFile(destino, novo);
    console.log(
      `escrito: public/elementos/${nome}.webp (${original.length} -> ${novo.length} bytes)`
    );
  }
}

if (confere) {
  if (diferentes > 0) {
    console.error('rode npm run elementos:gera');
    process.exit(1);
  }
  console.log('public/elementos confere');
}
