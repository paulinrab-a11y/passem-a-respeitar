// Gera lib/supabase/tipos.ts a partir do Supabase LOCAL (#320).
//
//   npm run e2e:banco     # sobe o banco com todas as migrations do repositorio
//   npm run tipos:gerar
//
// Local, e nao o projeto de producao: o banco local nasce das migrations
// commitadas, entao o arquivo gerado descreve o repositorio, e o CI consegue
// refazer a mesma conta sem secret nenhum. O job e2e roda este script depois
// de subir o banco e falha se o arquivo commitado for diferente.
//
// So o schema `public`: e o unico que o codigo consulta pelo cliente tipado.

import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DESTINO = fileURLToPath(new URL('../lib/supabase/tipos.ts', import.meta.url));

const CABECALHO = `// GERADO A PARTIR DO SCHEMA. Nao editar na mao: rodar \`npm run tipos:gerar\`
// com o Supabase local no ar (\`npm run e2e:banco\`). O job e2e do CI regenera
// e falha se este arquivo for diferente do que as migrations produzem.
//
// Aviso sobre \`Insert\` e \`Update\`: eles listam status, total_centavos e
// user_id como escreviveis. E so o TypeScript descrevendo colunas, ele nao
// sabe de GRANT nem de RLS. Pelo cliente do navegador essas escritas sao
// recusadas pelo banco. Ver supabase/migrations/20260923120000.
//
// Vale igual para produtos e produto_variacoes: \`preco_centavos\` aparece como
// escrevivel e \`estoque\` como legivel, e nenhum dos dois e verdade pelo
// cliente. O GRANT e por coluna e nao ha policy de escrita. Ver a migration
// 20260924100000.
//
// Nas funcoes, o gerador nao sabe quais colunas do retorno podem vir nulas nem
// aceita null em argumento com default: \`minhas_sessoes\` devolve \`agente\` e
// \`rede\` nulos quando o Supabase nao registrou, e quem le trata os dois como
// opcionais.

`;

// Comando inteiro numa string fixa, sem nada vindo de fora: no Windows o
// `npx` e um .cmd e so roda via shell.
const gerado = execSync('npx supabase gen types typescript --local --schema public', {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'inherit'],
});

writeFileSync(DESTINO, CABECALHO + gerado);

// O gerador escreve no estilo dele (aspas duplas, sem ponto e virgula). O
// Biome do repositorio reformata, e o arquivo continua dentro do lint: fora
// dele, ninguem repara quando para de compilar junto com o resto.
execSync(`npx biome check --write "${DESTINO}"`, { stdio: 'inherit' });
