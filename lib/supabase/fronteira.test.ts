import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A fronteira entre servidor e navegador, conferida no codigo.
 *
 * Os testes de clients.test.ts provam o comportamento de cada arquivo isolado.
 * Este aqui prova a propriedade que importa de verdade e que nenhum teste de
 * unidade alcanca: **a chave secreta nao tem caminho ate o navegador**.
 *
 * Vale lembrar por que: essa chave ignora a RLS inteira da Issue #18. Se ela
 * chegar ao bundle, todo o trabalho de policy vira enfeite e o banco fica
 * aberto para leitura e escrita por qualquer visitante.
 *
 * Quem de fato impede isso e o `import 'server-only'` mais o build do Next.
 * Este teste e a terceira trava, e a unica que falha em segundos em vez de
 * falhar em producao.
 */

const RAIZ = path.resolve(__dirname, '..', '..');
const SEGREDO = 'SUPABASE_SECRET_KEY';

function resolveImport(origem: string, especificador: string): string | null {
  let base: string;

  if (especificador.startsWith('.')) {
    base = path.resolve(path.dirname(origem), especificador);
  } else if (especificador.startsWith('@/')) {
    base = path.join(RAIZ, especificador.slice(2));
  } else {
    // Pacote de node_modules: fora do que este teste analisa.
    return null;
  }

  for (const tentativa of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
  ]) {
    if (fs.existsSync(tentativa) && fs.statSync(tentativa).isFile()) return tentativa;
  }
  return null;
}

function importsDe(arquivo: string): string[] {
  const src = fs.readFileSync(arquivo, 'utf8');
  const achados: string[] = [];
  const re = /(?:from|import)\s+['"]([^'"]+)['"]/g;

  let m = re.exec(src);
  while (m !== null) {
    achados.push(m[1]);
    m = re.exec(src);
  }
  return achados;
}

/** Todo arquivo alcancavel a partir de `entrada`, incluindo ela. */
function alcancaveis(entrada: string): string[] {
  const vistos = new Set<string>();
  const fila = [entrada];

  while (fila.length > 0) {
    const atual = fila.pop();
    if (!atual || vistos.has(atual)) continue;
    vistos.add(atual);

    for (const esp of importsDe(atual)) {
      const destino = resolveImport(atual, esp);
      if (destino && !vistos.has(destino)) fila.push(destino);
    }
  }
  return [...vistos];
}

function arquivosDoProjeto(): string[] {
  const saida: string[] = [];

  function anda(dir: string) {
    for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entrada.name.startsWith('.') || entrada.name === 'node_modules') continue;
      const cheio = path.join(dir, entrada.name);
      if (entrada.isDirectory()) anda(cheio);
      else if (/\.tsx?$/.test(entrada.name) && !entrada.name.endsWith('.test.ts'))
        saida.push(cheio);
    }
  }

  anda(path.join(RAIZ, 'app'));
  anda(path.join(RAIZ, 'lib'));
  return saida;
}

const ADMIN = path.join(RAIZ, 'lib', 'supabase', 'admin.ts');
const NAVEGADOR = path.join(RAIZ, 'lib', 'supabase', 'navegador.ts');
const SERVIDOR = path.join(RAIZ, 'lib', 'supabase', 'servidor.ts');

describe('fronteira servidor/navegador', () => {
  it('o que o navegador alcanca nunca menciona a chave secreta', () => {
    const vazando = alcancaveis(NAVEGADOR).filter((f) =>
      fs.readFileSync(f, 'utf8').includes(SEGREDO)
    );

    expect(vazando.map((f) => path.relative(RAIZ, f))).toEqual([]);
  });

  it('nenhum client component alcanca o client admin', () => {
    const culpados = arquivosDoProjeto()
      .filter((f) => /^\s*['"]use client['"]/m.test(fs.readFileSync(f, 'utf8')))
      .filter((f) => alcancaveis(f).includes(ADMIN))
      .map((f) => path.relative(RAIZ, f));

    expect(culpados).toEqual([]);
  });

  it.each([
    ['admin.ts', ADMIN],
    ['servidor.ts', SERVIDOR],
  ])('%s declara server-only', (_nome, arquivo) => {
    expect(fs.readFileSync(arquivo, 'utf8')).toMatch(/import\s+['"]server-only['"]/);
  });

  it('so o admin le a chave secreta', () => {
    const leem = arquivosDoProjeto()
      .filter((f) => fs.readFileSync(f, 'utf8').includes(SEGREDO))
      .map((f) => path.relative(RAIZ, f).replaceAll('\\', '/'));

    expect(leem).toEqual(['lib/supabase/admin.ts']);
  });

  // Se o caminhador estivesse quebrado — regex errada, resolucao de caminho
  // falhando — os testes acima passariam com lista vazia por nao acharem
  // nada. Este confere que ele de fato anda: navegador.ts importa ./env e
  // ./tipos, e os dois tem que aparecer.
  it('o caminhador realmente segue os imports', () => {
    const vistos = alcancaveis(NAVEGADOR).map((f) => path.relative(RAIZ, f).replaceAll('\\', '/'));

    expect(vistos).toContain('lib/supabase/navegador.ts');
    expect(vistos).toContain('lib/supabase/env.ts');
    expect(vistos).toContain('lib/supabase/tipos.ts');
  });

  it('o caminhador acha o admin quando alguem o importa', () => {
    expect(alcancaveis(ADMIN)).toContain(ADMIN);
    expect(alcancaveis(SERVIDOR)).not.toContain(ADMIN);
  });
});
