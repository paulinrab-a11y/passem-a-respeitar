import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Contraste de texto (#175).
 *
 * Quem mede o contraste de verdade e o teste de ponta a ponta, tela a tela,
 * no navegador. Este aqui roda sem navegador e pega o erro na origem: a
 * paleta tem tres cinzas, e o mais escuro nao serve para texto.
 *
 *   --prata    13,6 para 1 sobre o preto   texto
 *   --prata-2   5,4 para 1                  texto secundario
 *   --prata-3   1,9 para 1                  linha, borda, controle desabilitado
 *
 * A WCAG AA pede 4,5 para texto comum e 3 para texto grande.
 */
const CSS = readFileSync('app/globals.css', 'utf8');

const hex = (nome: string) => CSS.match(new RegExp(`--${nome}:(#[0-9a-f]{6})`))?.[1] ?? '';

function luz(cor: string) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = Number.parseInt(cor.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contraste(a: string, b: string) {
  const [claro, escuro] = [luz(a), luz(b)].sort((x, y) => y - x);
  return (claro + 0.05) / (escuro + 0.05);
}

/** Os fundos sobre os quais o site escreve: a pagina e o card de pedido. */
const FUNDOS = ['#000000', '#08080a', '#0a0a0a'];

describe('a paleta', () => {
  it.each(FUNDOS)('--prata e --prata-2 servem para texto sobre %s', (fundo) => {
    expect(contraste(hex('prata'), fundo)).toBeGreaterThanOrEqual(4.5);
    expect(contraste(hex('prata-2'), fundo)).toBeGreaterThanOrEqual(4.5);
  });

  it('--prata-3 nao serve para texto: nem o grande passaria', () => {
    expect(contraste(hex('prata-3'), '#000000')).toBeLessThan(3);
  });
});

describe('--prata-3 como cor de texto', () => {
  /** Regras que pintam TEXTO com o cinza mais escuro. `border-color` nao conta. */
  const regras = [...CSS.matchAll(/(?:^|\n)\s*([^{}\n]+)\{([^{}]*)\}/g)]
    .filter(([, , corpo]) => /(?:^|;)\s*color:var\(--prata-3\)/.test(corpo))
    .map(([, seletor]) => seletor.trim());

  it('so em controle desabilitado, que a WCAG isenta', () => {
    expect(regras.filter((s) => !/:disabled\b/.test(s))).toEqual([]);
  });

  it('e o teste enxerga as regras: os desabilitados estao na lista', () => {
    expect(regras.length).toBeGreaterThanOrEqual(3);
    expect(regras).toContain('.btn.perigo:disabled');
  });
});

describe('opacidade em texto', () => {
  // `opacity` multiplica o contraste para baixo sem aparecer na cor. Foi
  // assim que a etapa riscada da linha do tempo chegou a 1,2 para 1.
  it('a etapa que nao aconteceu e riscada, e nao apagada', () => {
    const regra = CSS.match(/\.etapas \.nao-aconteceu \.etapa-nome\{([^}]*)\}/)?.[1] ?? '';

    expect(regra).toContain('text-decoration:line-through');
    expect(regra).not.toContain('opacity');
  });
});

describe('o que nao se ve nao entra na ordem do Tab', () => {
  it('o campo de arquivo da foto e `hidden`, e nao escondido so da vista', () => {
    const foto = readFileSync('app/conta/Foto.tsx', 'utf8');
    const campo = foto.match(/<input\s[^>]*type="file"[^>]*>/)?.[0] ?? '';

    expect(campo).toMatch(/\shidden\s/);
    expect(campo).not.toContain('className="sr"');
  });
});
