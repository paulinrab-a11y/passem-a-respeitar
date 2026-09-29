// Grava os e-mails de conta e o guia (Issue #183).
//
//   node supabase/templates/gera.mjs            escreve os .html e o guia
//   node supabase/templates/gera.mjs --confere  so compara com o que esta no disco
//
// Os .html sao SAIDA de modelos.mjs: quem quiser mudar um texto muda la e roda
// este arquivo de novo. O teste reprova se alguem editar o .html na mao. Sem
// isso, em seis meses cada e-mail teria um rodape.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { saidas } from './modelos.mjs';

const PASTA = dirname(fileURLToPath(import.meta.url));
const soConfere = process.argv.includes('--confere');
let diferentes = 0;

for (const [nome, conteudo] of saidas()) {
  const caminho = join(PASTA, nome);

  if (!soConfere) {
    writeFileSync(caminho, conteudo);
    console.log(`escrito: ${nome}`);
    continue;
  }

  let noDisco = '';
  try {
    noDisco = readFileSync(caminho, 'utf8').replace(/\r\n/g, '\n');
  } catch {
    // Arquivo que ainda nao existe conta como diferente.
  }
  if (noDisco !== conteudo) {
    diferentes += 1;
    console.error(`diferente do gerador: ${nome}`);
  }
}

if (diferentes) process.exit(1);
