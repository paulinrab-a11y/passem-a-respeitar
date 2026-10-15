import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * O zod nao vai para o navegador (#353).
 *
 * O zod e do servidor: e ele que confere o que chega de formulario. Nenhum
 * componente de cliente valida com schema. Mesmo assim ele ia inteiro (~72 KB
 * com brotli) para a home, /entrar, /criar-conta e /checkout, porque um
 * componente de cliente importava uma constante ou um formatador de um modulo
 * que tambem declarava schemas. Basta um import desses para o bundler levar o
 * modulo todo, e o zod com ele.
 *
 * Este teste anda o grafo de imports estaticos de cada arquivo `'use client'`
 * de app/ e falha se algum caminho chegar ao pacote `zod`. Mesmo caminhador de
 * lib/supabase/fronteira.test.ts, com duas diferencas: devolve o caminho que
 * chegou la (para o erro dizer qual import trocar) e ignora `import type`, que
 * some na compilacao e nao leva nada ao bundle.
 */

const RAIZ = path.resolve(__dirname, '..');

/** Cada arquivo e lido uma vez: o grafo de cada cliente repete muito modulo. */
const lidos = new Map<string, string>();
function le(arquivo: string): string {
  let src = lidos.get(arquivo);
  if (src === undefined) {
    src = fs.readFileSync(arquivo, 'utf8');
    lidos.set(arquivo, src);
  }
  return src;
}

/** O pacote, ou um subcaminho dele (`zod/v4`, `zod/mini`). */
function ehZod(especificador: string) {
  return especificador === 'zod' || especificador.startsWith('zod/');
}

function resolveImport(origem: string, especificador: string): string | null {
  let base: string;

  if (especificador.startsWith('.')) {
    base = path.resolve(path.dirname(origem), especificador);
  } else if (especificador.startsWith('@/')) {
    base = path.join(RAIZ, especificador.slice(2));
  } else {
    // Pacote de node_modules: so o nome interessa, e quem confere e ehZod.
    return null;
  }

  for (const tentativa of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
  ]) {
    if (ehArquivo(tentativa)) return tentativa;
  }
  return null;
}

const existe = new Map<string, boolean>();
function ehArquivo(caminho: string): boolean {
  let sim = existe.get(caminho);
  if (sim === undefined) {
    sim = fs.statSync(caminho, { throwIfNoEntry: false })?.isFile() ?? false;
    existe.set(caminho, sim);
  }
  return sim;
}

/**
 * Especificadores de `import ... from`, `import '...'` e `export ... from`,
 * menos os `import type` / `export type`, que nao existem em tempo de execucao.
 */
function importsDe(arquivo: string): string[] {
  const src = le(arquivo);
  const achados: string[] = [];
  const re = /^\s*(?:import|export)\s+(type\s+)?(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]/gm;

  let m = re.exec(src);
  while (m !== null) {
    if (!m[1]) achados.push(m[2]);
    m = re.exec(src);
  }
  return achados;
}

function ehServerAction(arquivo: string) {
  return /^\s*['"]use server['"]/.test(le(arquivo));
}

function ehCliente(arquivo: string) {
  return /^\s*['"]use client['"]/m.test(le(arquivo));
}

/**
 * O caminho de `entrada` ate o zod, ou null se nao houver.
 *
 * Para em arquivo `'use server'`, como em fronteira.test.ts: o Next troca o
 * import de uma Server Action por uma referencia de RPC, e o que ela importa
 * nunca vai ao navegador.
 */
function caminhoAteOZod(entrada: string): string[] | null {
  const anterior = new Map<string, string | null>([[entrada, null]]);
  const fila = [entrada];

  while (fila.length > 0) {
    const atual = fila.shift();
    if (!atual) break;
    if (atual !== entrada && ehServerAction(atual)) continue;

    for (const esp of importsDe(atual)) {
      if (ehZod(esp)) {
        const caminho = [esp];
        for (let c: string | null = atual; c; c = anterior.get(c) ?? null) {
          caminho.unshift(path.relative(RAIZ, c).replaceAll('\\', '/'));
        }
        return caminho;
      }
      const destino = resolveImport(atual, esp);
      if (destino && !anterior.has(destino)) {
        anterior.set(destino, atual);
        fila.push(destino);
      }
    }
  }
  return null;
}

function arquivosDeApp(): string[] {
  const saida: string[] = [];

  function anda(dir: string) {
    for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entrada.name.startsWith('.') || entrada.name === 'node_modules') continue;
      const cheio = path.join(dir, entrada.name);
      if (entrada.isDirectory()) anda(cheio);
      else if (/\.tsx?$/.test(entrada.name) && !/\.test\.tsx?$/.test(entrada.name))
        saida.push(cheio);
    }
  }

  anda(path.join(RAIZ, 'app'));
  return saida;
}

describe('zod fora do navegador', () => {
  it('nenhum arquivo use client de app/ alcanca o zod', () => {
    const vazando = arquivosDeApp()
      .filter(ehCliente)
      .map(caminhoAteOZod)
      .filter((c): c is string[] => c !== null)
      .map((c) => c.join(' -> '));

    expect(vazando).toEqual([]);
    // Le o disco inteiro de app/ e o que ele importa: em maquina carregada
    // passa dos 5 s padrao.
  }, 30_000);

  // Sem estes, um caminhador quebrado (regex errada, resolucao falhando)
  // passaria o teste acima por nao achar nada.
  it('o caminhador acha o zod por import direto e indireto', () => {
    expect(caminhoAteOZod(path.join(RAIZ, 'lib', 'esquemas.ts'))).toEqual([
      'lib/esquemas.ts',
      'zod',
    ]);
    expect(caminhoAteOZod(path.join(RAIZ, 'lib', 'conta', 'pedidos.ts'))).toEqual([
      'lib/conta/pedidos.ts',
      'lib/loja/endereco.ts',
      'zod',
    ]);
  });

  it('o caminhador ignora import type', () => {
    const src = [
      "import type { z } from 'zod';",
      "export type { Endereco } from '@/lib/loja/endereco';",
      "import { cepLegivel } from '@/lib/loja/cep';",
    ].join('\n');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zod-'));
    const tmp = path.join(dir, 'so-tipos.ts');
    fs.writeFileSync(tmp, src);
    try {
      expect(importsDe(tmp)).toEqual(['@/lib/loja/cep']);
    } finally {
      fs.rmSync(dir, { recursive: true });
    }
  });

  it('o caminhador para na Server Action', () => {
    // app/checkout/acoes.ts e 'use server' e importa o endereco com zod; o
    // componente que chama a acao nao leva nada disso.
    expect(caminhoAteOZod(path.join(RAIZ, 'app', 'checkout', 'acoes.ts'))).not.toBeNull();
    expect(caminhoAteOZod(path.join(RAIZ, 'app', 'checkout', 'Entrega.tsx'))).toBeNull();
  });

  it('acha os componentes de cliente que deveria olhar', () => {
    const clientes = arquivosDeApp()
      .filter(ehCliente)
      .map((f) => path.relative(RAIZ, f).replaceAll('\\', '/'));

    expect(clientes).toContain('app/_ui/CodigoDeConfirmacao.tsx');
    expect(clientes).toContain('app/_home/FreteNaFicha.tsx');
    expect(clientes).toContain('app/checkout/Entrega.tsx');
  });
});
