import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * O que o audit de motion da #53 achou e nao pode voltar.
 *
 * Tres regras lidas do CSS. As excecoes estao escritas aqui, com o motivo:
 * excecao que nao esta na lista e defeito.
 */
const CSS = readFileSync('app/globals.css', 'utf8');

/** Cada regra que declara `transition`, com o seletor e o valor. */
const TRANSICOES = [...CSS.matchAll(/([^{}]+)\{[^{}]*?\btransition:([^;}]+)/g)].map((m) => ({
  seletor: m[1].replace(/\/\*[\s\S]*?\*\//g, '').trim(),
  valor: m[2].trim(),
}));

describe('transition', () => {
  it('acha as transicoes do site', () => {
    expect(TRANSICOES.length).toBeGreaterThan(20);
  });

  it('nenhuma anima propriedade de layout', () => {
    const deLayout = TRANSICOES.filter((t) =>
      /(?:^|,)\s*(?:width|height|top|left|right|bottom|margin[\w-]*|padding[\w-]*)\s/.test(t.valor)
    ).map((t) => t.seletor);

    expect(deLayout).toEqual([]);
  });

  it('nenhuma vale `all`: toda transicao diz o que anima', () => {
    // `transition:.2s` e `transition:all .2s` sao a mesma coisa.
    const todas = TRANSICOES.filter(
      (t) => t.valor !== 'none' && /^(?:all\b|\.?\d)/.test(t.valor)
    ).map((t) => `${t.seletor} { transition:${t.valor} }`);

    expect(todas).toEqual([]);
  });

  it('`ease` padrao so nos elos, que sao momento de marca', () => {
    const comEase = TRANSICOES.filter((t) => /\bease\b(?!-)/.test(t.valor)).map((t) => t.seletor);

    expect(comEase).toEqual(['.elo .box']);
  });
});

describe('sublinhado do menu', () => {
  it('cresce por transform, a partir da esquerda', () => {
    expect(CSS).toMatch(
      /#bar button::after,#bar a::after\{[^}]*width:100%;[^}]*transform:scaleX\(0\);transform-origin:left;transition:transform /
    );
    expect(CSS).toContain('#bar button:hover::after,#bar a:hover::after{transform:scaleX(1)}');
  });
});

describe('loops', () => {
  /** Loops que existem por um motivo, e o motivo. */
  const PERMITIDOS: Record<string, string> = {
    '#rec i': 'REC da abertura em VHS: identidade, vive so dentro da intro',
    '#hero .desce::after': 'convite a rolar, no hero',
    '.tocando .eq i': 'equalizador: so aparece enquanto o som toca',
    '.concierge-digitando.on .eq i': 'equalizador do concierge: so enquanto a resposta nao chega',
    '.esq::after,.esq-linha::after': 'brilho do esqueleto, enquanto o dado nao chega',
    '#merch .galeria figure::after': 'brilho da moldura, enquanto a foto nao chega',
    '#clipe .player.carregando::after': 'brilho do player, enquanto o video nao responde',
  };

  const loops = [
    ...CSS.matchAll(/(?:^|\n)([^{}\n]+)\{[^{}]*animation[^{}]*\binfinite\b[^{}]*\}/g),
  ].map((m) => m[1].trim());

  it('todo loop do site esta na lista, com motivo', () => {
    expect(loops.filter((s) => !(s in PERMITIDOS))).toEqual([]);
  });

  it('a lista nao guarda loop que ja saiu do site', () => {
    expect(Object.keys(PERMITIDOS).filter((s) => !loops.includes(s))).toEqual([]);
  });
});

/**
 * A entrada do manifesto animava `filter: blur(14px)` ate zero, com
 * `will-change: filter` fixo no CSS (#286). Agora o borrado e uma copia
 * parada, e a timeline so mexe em opacidade e transform.
 */
describe('abertura sem filter animado', () => {
  const SCRIPT = readFileSync('app/_home/legacy-site.js', 'utf8');
  const regra = (seletor: string) =>
    CSS.match(new RegExp(`(?:^|\\n)${seletor.replace(/[.#]/g, '\\$&')}\\{([^}]*)\\}`))?.[1] ?? '';

  it('nenhum will-change pede filter', () => {
    const pedidos = [...CSS.matchAll(/will-change:([^;}]+)/g)].map((m) => m[1]);

    expect(pedidos.length).toBeGreaterThan(0);
    expect(pedidos.filter((p) => /filter/.test(p))).toEqual([]);
  });

  it('a linha do manifesto nasce sem filter, so com opacidade e deslocamento', () => {
    const linha = regra('#manifesto .l');

    expect(linha).toContain('opacity:0');
    expect(linha).toContain('transform:translateY(6px) skewX(-2deg)');
    expect(linha).not.toMatch(/filter/);
  });

  it('o borrado e da copia, parado: sem transicao nem animacao', () => {
    const nevoa = regra('#manifesto .nevoa');

    expect(nevoa).toContain('filter:blur(14px)');
    expect(nevoa).not.toMatch(/transition|animation/);
    expect(nevoa).toContain('position:absolute');
  });

  it('a timeline da intro nao tweena filter', () => {
    expect(SCRIPT).not.toMatch(/\bfilter\s*:\s*['"`]/);
    expect(SCRIPT).toContain(
      "tl.to(camadas.nevoa, { opacity:0, duration: dur, ease: foco }, '<');"
    );
    expect(SCRIPT).toContain(
      "tl.to(camadas.nitida, { opacity:1, duration: dur, ease: foco }, '<');"
    );
  });

  it('a troca de camadas segue o quadrado da curva da linha', () => {
    expect(SCRIPT).toContain(
      "const curva = gsap.parseEase('power3.out'), foco = x => { const p = curva(x); return p*p; };"
    );
    expect(SCRIPT).toContain("const tl = gsap.timeline({ defaults:{ ease:'power3.out' } });");
  });
});

describe('relatorio', () => {
  it('esta no repositorio, em HTML de um arquivo so', () => {
    const html = readFileSync('motion-audits/passem-a-respeitar-2026-09-28.html', 'utf8');

    expect(html).toContain('<!doctype html>');
    expect(html).not.toMatch(/<script\b/);
    expect(html).not.toMatch(
      /<link[^>]+rel="stylesheet"[^>]+href="(?!https:\/\/fonts\.googleapis\.com)/
    );
  });
});
