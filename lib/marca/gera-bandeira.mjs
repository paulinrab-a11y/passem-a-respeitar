// Grava a bandeira da Occupation (#fim da home) a partir da arte do dono.
//
//   npm run bandeira:gera -- "C:\caminho\LOGO VARIANTES P.A.R (6).png"
//   BANDEIRA_ORIGEM="/caminho/logo.png" npm run bandeira:gera
//
// A arte original (preto sobre branco, 1080x1350) fica fora do repositorio.
// Saem as duas camadas em public/bandeira/ e a geometria que a home usa para
// encaixar o pano de volta no mastro, em lib/marca/bandeira-geometria.json.
// O porque de cada passo esta em lib/marca/bandeira.mjs.

import { mkdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { separa } from './bandeira.mjs';

const origem = process.argv[2] || process.env.BANDEIRA_ORIGEM;
if (!origem) {
  console.error('uso: npm run bandeira:gera -- "<caminho da arte .png>"  (ou BANDEIRA_ORIGEM=...)');
  process.exit(1);
}

const PASTA = new URL('../../public/bandeira/', import.meta.url);
mkdirSync(PASTA, { recursive: true });

const { figura, pano, geometria } = await separa(await readFile(origem));
await writeFile(new URL('occupation-figura.webp', PASTA), figura);
await writeFile(new URL('occupation-pano.webp', PASTA), pano);
await writeFile(
  new URL('./bandeira-geometria.json', import.meta.url),
  `${JSON.stringify(geometria, null, 2)}\n`
);
console.log(`escrito: public/bandeira/occupation-figura.webp (${figura.length} bytes)`);
console.log(`escrito: public/bandeira/occupation-pano.webp (${pano.length} bytes)`);
console.log('escrito: lib/marca/bandeira-geometria.json');
console.log(JSON.stringify(geometria));
