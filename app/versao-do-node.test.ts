import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// O CI aprovava em Node 22, a Vercel rodava 24 e os tipos eram do 26 (#329).
// Cada peca mora num arquivo diferente e nenhuma quebra o build quando sai da
// linha, entao este teste e o unico lugar que confere as quatro juntas.

const raiz = join(__dirname, '..');
const le = (arquivo: string) => readFileSync(join(raiz, arquivo), 'utf8');

const pacote = JSON.parse(le('package.json')) as {
  engines?: { node?: string };
  devDependencies: Record<string, string>;
};
const nvmrc = le('.nvmrc').trim();
const ci = le('.github/workflows/ci.yml');
const dependabot = le('.github/dependabot.yml');

const major = (versao: string) => versao.match(/\d+/)?.[0];

describe('versao do node', () => {
  it('.nvmrc fixa so a linha major', () => {
    expect(nvmrc).toMatch(/^\d+$/);
  });

  it('engines do package.json e a mesma linha do .nvmrc (e o que a Vercel usa)', () => {
    expect(pacote.engines?.node).toBe(`${nvmrc}.x`);
  });

  it('@types/node acompanha o runtime', () => {
    expect(major(pacote.devDependencies['@types/node'])).toBe(nvmrc);
  });

  it('todo setup-node do CI le o .nvmrc, sem versao solta no yaml', () => {
    const passos = ci.split('actions/setup-node@').slice(1);
    expect(passos.length).toBeGreaterThan(0);
    for (const passo of passos) {
      const bloco = passo.split('- uses:')[0];
      expect(bloco).toContain('node-version-file: .nvmrc');
      expect(bloco).not.toMatch(/node-version:/);
    }
    expect(ci).not.toMatch(/NODE_VERSION/);
  });

  it('dependabot nao sobe major de @types/node sozinho', () => {
    expect(dependabot).toMatch(
      /- dependency-name: '@types\/node'\s+update-types: \[version-update:semver-major\]/
    );
  });
});
