import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Guarda da #22: toda rota de API e toda server action limitam, e todo 429
 * diz quando voltar.
 *
 * E um teste sobre o CODIGO, nao sobre o comportamento — de proposito. O
 * comportamento de cada limite ja tem teste no proprio arquivo; o que
 * ninguem testa e a rota que ainda nao existe. Quem criar uma sem `limita()`
 * ve este teste cair no primeiro CI, com o nome do arquivo.
 */

const RAIZ = join(__dirname, '..');

function arquivos(dir: string, pega: (nome: string) => boolean, saida: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) arquivos(caminho, pega, saida);
    else if (pega(nome)) saida.push(caminho);
  }
  return saida;
}

const rotas = arquivos(join(RAIZ, 'api'), (n) => n === 'route.ts');
const acoes = arquivos(RAIZ, (n) => /^(acoes|excluir)\.ts$/.test(n));

const relativo = (c: string) => c.slice(RAIZ.length).replace(/\\/g, '/');

describe('toda rota de API limita', () => {
  it('existe pelo menos uma rota (senao o teste nao testa nada)', () => {
    expect(rotas.length).toBeGreaterThan(0);
  });

  it.each(rotas.map((c) => [relativo(c), c]))('%s chama limita()', (_nome, caminho) => {
    expect(readFileSync(caminho, 'utf8')).toMatch(/\blimita\(/);
  });

  // 429 sem Retry-After e um "nao" sem "ate quando". Cliente honesto nao sabe
  // se espera um segundo ou uma hora; o provedor de pagamento reenvia no
  // escuro.
  it.each(rotas.map((c) => [relativo(c), c]))(
    '%s manda Retry-After em todo 429',
    (_nome, caminho) => {
      const fonte = readFileSync(caminho, 'utf8');
      const quantos429 = (fonte.match(/status: 429/g) ?? []).length;
      const quantosRetry = (fonte.match(/'Retry-After'/g) ?? []).length;

      expect(quantosRetry).toBeGreaterThanOrEqual(quantos429);
    }
  );
});

describe('toda server action com escrita limita', () => {
  it('acha as acoes conhecidas', () => {
    expect(acoes.map(relativo)).toEqual(
      expect.arrayContaining(['/entrar/acoes.ts', '/checkout/acoes.ts', '/conta/acoes.ts'])
    );
  });

  it.each(acoes.map((c) => [relativo(c), c]))('%s chama limita()', (_nome, caminho) => {
    expect(readFileSync(caminho, 'utf8')).toMatch(/\blimita\(/);
  });
});
