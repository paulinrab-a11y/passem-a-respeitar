import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Entrada de pagina e de secao (#48). Os criterios da issue, lidos do CSS:
 *
 *   - fade com deslocamento curto, de 150 a 250 ms
 *   - cascata de 30 a 50 ms entre itens, e so nos primeiros
 *   - so `transform` e `opacity`
 *   - com movimento reduzido, fade simples — e nao ausencia de entrada
 */
const CSS = readFileSync('app/globals.css', 'utf8');

function blocosDeMovimentoReduzido(css: string): string {
  const abertura = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{/g;
  const blocos: string[] = [];
  let achado = abertura.exec(css);
  while (achado !== null) {
    let fundo = 1;
    let i = achado.index + achado[0].length;
    const inicio = i;
    while (i < css.length && fundo > 0) {
      if (css[i] === '{') fundo++;
      else if (css[i] === '}') fundo--;
      i++;
    }
    blocos.push(css.slice(inicio, i - 1));
    achado = abertura.exec(css);
  }
  return blocos.join('\n');
}

const REDUZIDO = blocosDeMovimentoReduzido(CSS);
/** O CSS sem os blocos de movimento reduzido: o que vale para todo mundo. */
const NORMAL = CSS.replace(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\n\}/g, '');

const emMs = (valor: string) =>
  valor.endsWith('ms') ? Number.parseFloat(valor) : Number.parseFloat(valor) * 1000;

/** Entradas de pagina e de lista. Modal, toast e menu sao da #49. */
const ENTRADAS = ['auth-entra', 'pedido-entra', 'etapa-entra', 'sessao-entra', 'so-fade'];

describe('keyframes de entrada', () => {
  it.each(ENTRADAS)('%s so mexe em opacity e transform', (nome) => {
    const corpo = CSS.match(new RegExp(`@keyframes ${nome}\\{((?:[^{}]*\\{[^{}]*\\})*)\\}`))?.[1];

    expect(corpo, `@keyframes ${nome}`).toBeDefined();
    const propriedades = [...(corpo ?? '').matchAll(/(?:\{|;)\s*([a-z-]+)\s*:/g)].map((m) => m[1]);
    expect(propriedades.length).toBeGreaterThan(0);
    expect(propriedades.filter((p) => p !== 'opacity' && p !== 'transform')).toEqual([]);
  });

  it('a entrada de pagina nao usa blur', () => {
    expect(CSS).not.toMatch(/@keyframes auth-entra\{[^@]*filter/);
  });

  it('o deslocamento e curto: ate 12px', () => {
    const deslocamentos = [
      ...NORMAL.matchAll(
        /@keyframes (?:auth|pedido|etapa|sessao)-entra\{from\{[^}]*translateY\((-?\d+)px\)/g
      ),
      ...NORMAL.matchAll(/(?:^|\n)[^{}\n]*\.entra[^{}\n]*\{[^}]*translateY\((-?\d+)px\)/g),
    ].map((m) => Math.abs(Number(m[1])));

    expect(deslocamentos.length).toBeGreaterThan(4);
    expect(Math.max(...deslocamentos)).toBeLessThanOrEqual(12);
  });
});

describe('duracao entre 150 e 250 ms', () => {
  const usos = [
    ...NORMAL.matchAll(/animation:((?:auth|pedido|etapa|sessao)-entra) ([\d.]+m?s)/g),
  ].map((m) => [m[1], emMs(m[2])] as const);

  it('acha as quatro entradas em uso', () => {
    expect(usos.map(([nome]) => nome).sort()).toEqual([
      'auth-entra',
      'etapa-entra',
      'pedido-entra',
      'sessao-entra',
    ]);
  });

  it.each(usos)('%s dura %d ms', (_nome, ms) => {
    expect(ms).toBeGreaterThanOrEqual(150);
    expect(ms).toBeLessThanOrEqual(250);
  });

  it('as secoes da home entram em 250 ms, com a curva do projeto', () => {
    const transicoes = [...NORMAL.matchAll(/\.entra\.vis[^{}]*\{[^}]*transition:([^;}]+)/g)].map(
      (m) => m[1]
    );

    expect(transicoes.length).toBe(2);
    for (const t of transicoes) {
      expect(t).toBe(
        'opacity .25s cubic-bezier(.22,1,.36,1),transform .25s cubic-bezier(.22,1,.36,1)'
      );
    }
  });
});

describe('cascata de 30 a 50 ms, so nos primeiros', () => {
  /** Atrasos por `:nth-child(k)`, agrupados pelo seletor sem o nth-child. */
  function cascatas() {
    const grupos = new Map<string, { k: number; ms: number }[]>();
    const regra =
      /([^{}\n]+):nth-child\((\d+|n\+\d+)\)\{(?:animation|transition)-delay:([\d.]+m?s)\}/g;
    for (const m of NORMAL.matchAll(regra)) {
      // O equalizador defasa as barras de um LOOP; nao e entrada de nada.
      if (m[1].includes('.eq ')) continue;
      const k = Number(m[2].replace('n+', ''));
      const lista = grupos.get(m[1]) ?? [];
      lista.push({ k, ms: emMs(m[3]) });
      grupos.set(m[1], lista);
    }
    return [...grupos.entries()];
  }

  it('acha as tres cascatas do CSS', () => {
    expect(cascatas().map(([seletor]) => seletor)).toEqual([
      '.auth-caixa>*',
      '.etapas li',
      '#galeriaMerch.entra.vis figure',
    ]);
  });

  it.each(cascatas())('%s: passo constante entre 30 e 50 ms', (_seletor, itens) => {
    for (const { k, ms } of itens) {
      const passo = ms / (k - 1);
      expect(passo).toBeGreaterThanOrEqual(30);
      expect(passo).toBeLessThanOrEqual(50);
    }
  });

  it.each(cascatas())('%s: para no sexto item', (_seletor, itens) => {
    expect(Math.max(...itens.map((i) => i.k))).toBeLessThanOrEqual(6);
    // O ultimo da fila nunca espera mais de um quarto de segundo.
    expect(Math.max(...itens.map((i) => i.ms))).toBeLessThanOrEqual(250);
  });

  it('as cascatas que chegam inline tambem ficam em 40 ms e nos quatro primeiros', () => {
    const pedidos = readFileSync('app/conta/pedidos/page.tsx', 'utf8');
    const sessoes = readFileSync('app/conta/seguranca/Sessoes.tsx', 'utf8');

    expect(pedidos).toMatch(/const COM_STAGGER = 4;/);
    expect(pedidos).toMatch(/const PASSO_MS = 40;/);
    expect(sessoes).toMatch(/i < 4 \? \{ animationDelay: `\$\{i \* 40\}ms` \}/);
  });
});

describe('movimento reduzido vira fade simples', () => {
  it.each(['.auth-caixa>*', '.pedidos>li', '.sessoes li', '.etapas li'])(
    '%s troca a entrada por so-fade, sem atraso',
    (seletor) => {
      const regra = REDUZIDO.split('\n')
        .map((l) => l.trim())
        .find((l) => l.startsWith(`${seletor}{`));

      expect(regra, seletor).toBeDefined();
      expect(regra).toContain('animation-name:so-fade');
      expect(regra).toMatch(/animation-delay:0m?s!important/);
      expect(regra).not.toContain('animation:none');
    }
  );

  it('as secoes da home perdem o deslocamento e a cascata, e ficam com o fade', () => {
    expect(REDUZIDO).toContain('.entra,#galeriaMerch.entra figure{transform:none}');
    expect(REDUZIDO).toMatch(
      /\.entra\.vis,#galeriaMerch\.entra\.vis figure\{transition:opacity \.2s [^;]+;transition-delay:0s!important\}/
    );
  });
});

describe('a classe de entrada e posta pelo script, nunca pelo HTML', () => {
  function tsx(raiz: string): string[] {
    return readdirSync(raiz, { withFileTypes: true }).flatMap((item) => {
      const caminho = join(raiz, item.name);
      if (item.isDirectory()) return tsx(caminho);
      return item.name.endsWith('.tsx') && !item.name.endsWith('.test.tsx') ? [caminho] : [];
    });
  }

  it('nenhum componente escreve `entra` no className', () => {
    // Se a classe viesse no HTML, o conteudo nasceria invisivel e dependeria do
    // JavaScript para aparecer.
    const quem = tsx('app').filter((a) =>
      /className=(?:"[^"]*\bentra\b[^"]*"|\{`[^`]*\bentra\b)/.test(readFileSync(a, 'utf8'))
    );

    expect(quem).toEqual([]);
  });

  it('sem IntersectionObserver o script mostra tudo', () => {
    const script = readFileSync('app/_home/legacy-site.js', 'utf8');

    expect(script).toContain(
      "if (!('IntersectionObserver' in window)){ alvos.forEach(mostra); return; }"
    );
  });

  it('elos, hero e intro nao entram na lista: sao momento de marca', () => {
    const script = readFileSync('app/_home/legacy-site.js', 'utf8');
    const lista = script.match(/const alvos = \[([^\]]+)\]/)?.[1] ?? '';

    expect(lista).not.toMatch(/elo|hero|intro|manifesto/);
    expect(lista).toContain('#merch .ficha');
  });
});
