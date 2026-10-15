// Roda cada .sql de supabase/tests contra o Supabase LOCAL (#335).
//
//   npm run e2e:banco      # sobe o banco com todas as migrations
//   npm run banco:testes
//
// O psql e o de dentro do container do banco: a mesma versao do servidor, e
// nada para instalar na maquina nem no runner. O nome do container sai do
// project_id do config.toml, que a CLI usa para nomear os dela. Nunca fala
// com producao: o unico alvo e esse container local.
//
// Cada arquivo roda numa sessao propria, com ON_ERROR_STOP. A leitura da
// saida e a de veredito.mjs.

import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { reprovacoes } from './veredito.mjs';

const PASTA = fileURLToPath(new URL('.', import.meta.url));
const CONFIG = readFileSync(new URL('../config.toml', import.meta.url), 'utf8');
const projeto = /^project_id\s*=\s*"([^"]+)"/m.exec(CONFIG)?.[1];
if (!projeto) throw new Error('project_id nao encontrado em supabase/config.toml');
const CONTAINER = `supabase_db_${projeto}`;

const arquivos = readdirSync(PASTA)
  .filter((f) => f.endsWith('.sql'))
  .sort();

let falhas = 0;
for (const arquivo of arquivos) {
  const r = spawnSync(
    'docker',
    [
      'exec',
      '-i',
      CONTAINER,
      'psql',
      '-X',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '-v',
      'ON_ERROR_STOP=1',
      '-P',
      'pager=off',
    ],
    { input: readFileSync(`${PASTA}/${arquivo}`, 'utf8'), encoding: 'utf8' }
  );

  const saida = `${r.stdout ?? ''}`;
  const motivos =
    r.status === 0
      ? reprovacoes(saida)
      : [`psql saiu com ${r.status ?? r.error?.message}: ${(r.stderr ?? '').trim()}`];

  if (motivos.length === 0) {
    console.log(`ok     ${arquivo}`);
    continue;
  }
  falhas += 1;
  console.log(`FALHOU ${arquivo}`);
  for (const m of motivos) console.log(`       ${m}`);
  console.log(saida);
}

console.log(`\n${arquivos.length - falhas}/${arquivos.length} arquivos sem falha`);
if (falhas > 0) process.exit(1);
