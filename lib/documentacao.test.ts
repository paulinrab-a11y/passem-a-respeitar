import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A documentacao que descreve o codigo nao pode ficar para tras dele (#323).
 *
 * Dois desvios ja aconteceram: um bloco SMTP_* no .env.example que nenhum
 * codigo lia, e migrations em producao sem a versao remota anotada. Os dois
 * testes abaixo pegam a proxima vez.
 */

const RAIZ = process.cwd();

// Onde uma variavel de ambiente pode ser lida: o codigo do site, a suite de
// ponta a ponta, o CI e os arquivos de configuracao da raiz.
const PASTAS = ['app', 'lib', 'e2e', 'supabase', '.github'];
const EXTENSOES = /\.(ts|tsx|mts|mjs|js|yml|yaml|toml|json)$/;

function arquivosDe(pasta: string): string[] {
  const caminho = join(RAIZ, pasta);
  return readdirSync(caminho).flatMap((nome) => {
    const filho = join(pasta, nome);
    if (statSync(join(RAIZ, filho)).isDirectory()) return arquivosDe(filho);
    return EXTENSOES.test(nome) ? [filho] : [];
  });
}

function codigoDoProjeto(): string {
  const raiz = readdirSync(RAIZ).filter(
    (nome) =>
      EXTENSOES.test(nome) && !nome.startsWith('package') && statSync(join(RAIZ, nome)).isFile()
  );
  return [...raiz, ...PASTAS.flatMap(arquivosDe)]
    .filter((arquivo) => !arquivo.endsWith('documentacao.test.ts'))
    .map((arquivo) => readFileSync(join(RAIZ, arquivo), 'utf8'))
    .join('\n');
}

describe('.env.example', () => {
  it('so lista variavel que algum codigo le', () => {
    const exemplo = readFileSync(join(RAIZ, '.env.example'), 'utf8');
    const variaveis = [...exemplo.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]);
    expect(variaveis.length).toBeGreaterThan(0);

    const codigo = codigoDoProjeto();
    const semUso = variaveis.filter((nome) => !new RegExp(`\\b${nome}\\b`).test(codigo));
    expect(semUso).toEqual([]);
  });
});

describe('README, secao Migrations em producao', () => {
  it('tem uma linha para cada arquivo de supabase/migrations', () => {
    const readme = readFileSync(join(RAIZ, 'README.md'), 'utf8');
    const arquivos = readdirSync(join(RAIZ, 'supabase', 'migrations')).filter((nome) =>
      nome.endsWith('.sql')
    );
    expect(arquivos.length).toBeGreaterThan(0);

    const foraDaTabela = arquivos.filter((nome) => !readme.includes(`| \`${nome}\` |`));
    expect(foraDaTabela).toEqual([]);
  });
});
