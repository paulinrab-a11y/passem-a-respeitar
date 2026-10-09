// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { giro360 } from './giro-360';

/**
 * A vitrine em fotos no celular (#294). O que o navegador faz com o toque —
 * rolar ou entregar o arraste — depende do `touch-action`, e isso so o e2e
 * com toque emulado mede (e2e/loja-no-celular.spec.ts). Aqui, o que chega
 * depois: os eventos de ponteiro e o relogio da rotacao automatica.
 */

const PASSO = 80;
const INTERVALO = 1400;

let vit: HTMLElement;
let quadros: number[];

function monta(reduz = false) {
  document.body.innerHTML = '<div id="vitrine" class="vitrine"><div class="dica"></div></div>';
  vit = document.getElementById('vitrine') as HTMLElement;
  quadros = [];
  return giro360(vit, { pinta: (q) => quadros.push(q), reduz });
}

const ultimo = () => quadros[quadros.length - 1];

function ponteiro(tipo: string, clientX: number) {
  vit.dispatchEvent(new PointerEvent(tipo, { clientX, pointerId: 1, bubbles: true }));
}

/** Encosta em `de`, arrasta ate `ate` em passos de 10 px e solta com `fim`. */
function arrasta(de: number, ate: number, fim: 'pointerup' | 'pointercancel' = 'pointerup') {
  ponteiro('pointerdown', de);
  const sentido = Math.sign(ate - de);
  for (let x = de + sentido * 10; sentido * (ate - x) >= 0; x += sentido * 10) {
    ponteiro('pointermove', x);
  }
  ponteiro(fim, ate);
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('giro360', () => {
  it('abre no primeiro quadro e gira sozinho', () => {
    const giro = monta();
    expect(quadros).toEqual([0]);

    giro.giraSozinho();
    vi.advanceTimersByTime(INTERVALO * 5);
    expect(quadros).toEqual([0, 1, 2, 3, 0, 1]);
  });

  it('toque simples nao para a rotacao nem esconde a dica', () => {
    const giro = monta();
    giro.giraSozinho();

    ponteiro('pointerdown', 200);
    ponteiro('pointerup', 200);

    expect(vit.classList.contains('usada')).toBe(false);
    vi.advanceTimersByTime(INTERVALO * 2);
    expect(quadros).toEqual([0, 1, 2]);
  });

  it('arraste que o navegador tomou como rolagem tambem nao', () => {
    const giro = monta();
    giro.giraSozinho();

    // Sem o `pan-y`, o `pointercancel` chegava uns 40 px depois.
    arrasta(200, 240, 'pointercancel');

    expect(vit.classList.contains('usada')).toBe(false);
    vi.advanceTimersByTime(INTERVALO);
    expect(ultimo()).toBe(1);
  });

  it('o arraste troca um quadro a cada 80 px, e para a rotacao no primeiro', () => {
    const giro = monta();
    giro.giraSozinho();

    // Para a direita, a camiseta volta um quadro.
    arrasta(100, 100 + PASSO + 20);
    expect(ultimo()).toBe(3);
    expect(vit.classList.contains('usada')).toBe(true);

    // Para a esquerda, avanca; o resto do arraste anterior nao conta.
    arrasta(300, 300 - 2 * PASSO - 10);
    expect(quadros).toEqual([0, 3, 0, 1]);

    vi.advanceTimersByTime(INTERVALO * 5);
    expect(quadros).toEqual([0, 3, 0, 1]);
  });

  it('ponteiro passando sem encostar, ou depois de soltar, nao gira', () => {
    monta();

    for (let x = 0; x <= 400; x += 10) ponteiro('pointermove', x);
    arrasta(100, 150);
    for (let x = 150; x <= 400; x += 10) ponteiro('pointermove', x);

    expect(quadros).toEqual([0]);
  });

  it('as setas giram pela pessoa e tambem param a rotacao', () => {
    const giro = monta();
    giro.giraSozinho();

    giro.gira(1);
    giro.gira(1);
    giro.gira(-1);
    expect(quadros).toEqual([0, 1, 2, 1]);
    expect(vit.classList.contains('usada')).toBe(true);

    vi.advanceTimersByTime(INTERVALO * 3);
    expect(quadros).toEqual([0, 1, 2, 1]);
  });

  it('reabrir a loja religa a rotacao, sem empilhar relogio', () => {
    const giro = monta();
    giro.giraSozinho();
    arrasta(100, 100 - PASSO);
    expect(ultimo()).toBe(1);

    // A loja fecha e abre de novo, duas vezes.
    giro.para();
    giro.giraSozinho();
    giro.giraSozinho();

    vi.advanceTimersByTime(INTERVALO * 2);
    expect(quadros).toEqual([0, 1, 2, 3]);
  });

  it('fechada, a loja nao gira', () => {
    const giro = monta();
    giro.giraSozinho();
    giro.para();

    vi.advanceTimersByTime(INTERVALO * 5);
    expect(quadros).toEqual([0]);
  });

  it('com reduzir movimento nada gira sozinho, e o arraste e as setas continuam', () => {
    const giro = monta(true);
    giro.giraSozinho();

    vi.advanceTimersByTime(INTERVALO * 5);
    expect(quadros).toEqual([0]);

    arrasta(100, 100 + PASSO);
    giro.gira(1);
    giro.gira(1);
    expect(quadros).toEqual([0, 3, 0, 1]);
  });
});

describe('vitrine no CSS e no script legado', () => {
  const CSS = readFileSync('app/globals.css', 'utf8');
  const SCRIPT = readFileSync('app/_home/legacy-site.js', 'utf8');
  const regra = (seletor: string) =>
    CSS.match(new RegExp(`(?:^|\\n)${seletor.replace(/[.#]/g, '\\$&')}\\{([^}]*)\\}`))?.[1] ?? '';

  it('a vitrine deixa com o navegador so a rolagem vertical', () => {
    expect(regra('#loja .vitrine')).toContain('touch-action:pan-y');
    // A `.giro` herda o limite da vitrine; um `touch-action` proprio nao amplia
    // o que o pai restringe, mas e sinal de quem esqueceu disto.
    expect(regra('#loja .giro')).not.toContain('touch-action');
  });

  it('o canvas do 3D continua com o arraste nos dois eixos', () => {
    expect(regra('#loja .vitrine canvas')).toContain('touch-action:none');
  });

  it('o script legado usa o giro, religa ao abrir e para ao fechar', () => {
    expect(SCRIPT).toContain("import { giro360 } from './giro-360';");
    expect(SCRIPT).toContain('fotos = giro360(vit, {');
    expect(SCRIPT).toContain('reduz: reduzMotion });');
    expect(SCRIPT).toMatch(
      /aberto = true;[^\n]*\n(?:\s*\/\/[^\n]*\n)*\s*if \(fotos\) fotos\.giraSozinho\(\);/
    );
    expect(SCRIPT).toMatch(/modalAnimado\(el, \(\)=>\{[^\n]*if \(fotos\) fotos\.para\(\);/);
    // O relogio antigo, que o `pointerdown` desligava, saiu de vez.
    expect(SCRIPT).not.toMatch(/\bgiroTimer\b/);
  });
});
