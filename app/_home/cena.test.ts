import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { giroDaCorrente, paralaxe, pulsoDaLuz, relogio, vigiaDeQuadro } from './cena';

/**
 * A cena 3D com "reduzir movimento" (#286): o que ela faz sozinha no tempo e
 * quando um quadro vai para a GPU.
 */

const INSTANTES = [0, 0.016, 1, 7.3, 60, 3600];

describe('relogio e paralaxe', () => {
  it('com movimento reduzido, o tempo e o mouse param em zero', () => {
    for (const t of INSTANTES) expect(relogio(t, true)).toBe(0);
    expect(paralaxe(0.4, true)).toBe(0);
    expect(paralaxe(-0.5, true)).toBe(0);
  });

  it('sem a preferencia, passam inteiros', () => {
    for (const t of INSTANTES) expect(relogio(t, false)).toBe(t);
    expect(paralaxe(0.4, false)).toBe(0.4);
  });
});

describe('giro da corrente', () => {
  it('com movimento reduzido, nao gira com o tempo nem com o mouse', () => {
    const giros = INSTANTES.map((t) => giroDaCorrente(t, 0.3, 0.45, true));

    expect(new Set(giros).size).toBe(1);
    expect(giroDaCorrente(9, 0.3, -0.5, true)).toBe(giros[0]);
  });

  it('com movimento reduzido, continua andando com a rolagem', () => {
    expect(giroDaCorrente(5, 0, 0, true)).toBe(0);
    expect(giroDaCorrente(5, 0.5, 0, true)).toBeCloseTo(0.6);
    expect(giroDaCorrente(5, 1, 0, true)).toBeCloseTo(1.2);
  });

  it('sem a preferencia, gira devagar no tempo e segue o mouse, como sempre', () => {
    expect(giroDaCorrente(10, 0.5, 0.2, false)).toBeCloseTo(10 * 0.12 + 0.5 * 1.2 + 0.2 * 0.35);
    expect(giroDaCorrente(1, 0, 0, false)).not.toBe(giroDaCorrente(2, 0, 0, false));
  });
});

describe('pulso da luz vermelha', () => {
  it('com movimento reduzido, nao pulsa: so acende com o fim', () => {
    const luzes = INSTANTES.map((t) => pulsoDaLuz(t, 0, true));

    expect(new Set(luzes).size).toBe(1);
    expect(luzes[0]).toBe(1.5);
    expect(pulsoDaLuz(42, 1, true)).toBe(3);
  });

  it('sem a preferencia, pulsa no tempo, como sempre', () => {
    const luzes = INSTANTES.slice(1).map((t) => pulsoDaLuz(t, 0, false));

    expect(new Set(luzes).size).toBe(luzes.length);
    expect(pulsoDaLuz(1, 0.5, false)).toBeCloseTo(1.5 + Math.sin(1.7) * 0.35 + 0.75);
  });
});

describe('vigiaDeQuadro', () => {
  it('o primeiro quadro sempre vai para a GPU', () => {
    expect(vigiaDeQuadro().precisaDesenhar([1, 2, 3])).toBe(true);
  });

  it('cena parada nao e redesenhada', () => {
    const vigia = vigiaDeQuadro();
    vigia.precisaDesenhar([1, 2, 3]);

    expect(vigia.precisaDesenhar([1, 2, 3])).toBe(false);
    expect(vigia.precisaDesenhar([1, 2, 3])).toBe(false);
  });

  it('o que andou alem da tolerancia e redesenhado', () => {
    const vigia = vigiaDeQuadro(1e-3);
    vigia.precisaDesenhar([1, 2, 3]);

    expect(vigia.precisaDesenhar([1, 2.0005, 3])).toBe(false);
    expect(vigia.precisaDesenhar([1, 2, 3.002])).toBe(true);
    expect(vigia.precisaDesenhar([1, 2, 3.002])).toBe(false);
  });

  it('o lerp que anda devagar acumula ate sair num quadro: compara com o ultimo desenhado', () => {
    const vigia = vigiaDeQuadro(1e-3);
    vigia.precisaDesenhar([0]);

    // Passos de 0,0004: nenhum passa da tolerancia sozinho, o terceiro soma 0,0012.
    expect(vigia.precisaDesenhar([0.0004])).toBe(false);
    expect(vigia.precisaDesenhar([0.0008])).toBe(false);
    expect(vigia.precisaDesenhar([0.0012])).toBe(true);
    expect(vigia.precisaDesenhar([0.0016])).toBe(false);
  });

  it('assenta: um lerp de camera para de ir para a GPU', () => {
    const vigia = vigiaDeQuadro();
    let x = 0;
    let desenhos = 0;
    let ultimoDesenho = 0;
    for (let quadro = 1; quadro <= 600; quadro++) {
      x += (1 - x) * 0.08;
      if (vigia.precisaDesenhar([x])) {
        desenhos++;
        ultimoDesenho = quadro;
      }
    }

    expect(desenhos).toBeGreaterThan(50);
    // Dez segundos a 60 quadros: o fim dos 600 e so de quadros pulados.
    expect(ultimoDesenho).toBeLessThan(150);
    expect(Math.abs(1 - x)).toBeLessThan(1e-4);
  });

  it('invalida: o que muda a imagem sem passar pelo estado redesenha uma vez', () => {
    const vigia = vigiaDeQuadro();
    vigia.precisaDesenhar([1]);

    vigia.invalida();
    expect(vigia.precisaDesenhar([1])).toBe(true);
    expect(vigia.precisaDesenhar([1])).toBe(false);
  });

  it('PNG ou frase que entrou na cena muda o tamanho do estado e redesenha', () => {
    const vigia = vigiaDeQuadro();
    vigia.precisaDesenhar([1, 2]);

    expect(vigia.precisaDesenhar([1, 2, 0])).toBe(true);
    expect(vigia.precisaDesenhar([1, 2, 0])).toBe(false);
  });

  it('NaN nao conta como parado', () => {
    const vigia = vigiaDeQuadro();
    vigia.precisaDesenhar([Number.NaN]);

    expect(vigia.precisaDesenhar([Number.NaN])).toBe(true);
  });

  it('guarda uma copia: mexer no array depois nao engana a comparacao', () => {
    const vigia = vigiaDeQuadro();
    const pose = [0, 0];
    vigia.precisaDesenhar(pose);

    pose[0] = 0.5;
    expect(vigia.precisaDesenhar(pose)).toBe(true);
  });
});

/**
 * O contrato com o script legado, que nao roda no jsdom (depende do three).
 * O que se segura aqui e que ele passa pelas funcoes de cima.
 */
const SCRIPT = readFileSync('app/_home/legacy-site.js', 'utf8');

/**
 * Corpo de `function <nome>(...){...}` no script, contando chaves. `depois`
 * desempata nome repetido: o grao do VHS tambem tem um `loop`.
 */
function corpo(nome: string, depois = ''): string {
  const desde = SCRIPT.indexOf(depois);
  expect(desde, depois).toBeGreaterThan(-1);
  const cabeca = new RegExp(`function ${nome}\\([^)]*\\)\\{`, 'g');
  cabeca.lastIndex = desde;
  const inicio = cabeca.exec(SCRIPT)?.index ?? -1;
  expect(inicio, `function ${nome}`).toBeGreaterThan(-1);
  let i = SCRIPT.indexOf('{', inicio) + 1;
  const de = i;
  let fundo = 1;
  while (fundo > 0 && i < SCRIPT.length) {
    if (SCRIPT[i] === '{') fundo++;
    else if (SCRIPT[i] === '}') fundo--;
    i++;
  }
  return SCRIPT.slice(de, i - 1);
}

describe('script legado: fundo 3D', () => {
  const frame = corpo('frame');

  it('o tempo cru so entra pelo relogio e pelas funcoes que respeitam a preferencia', () => {
    const usos = frame.match(/(?<![\w.$])t(?![\w$])/g) ?? [];

    expect(frame).toContain('tA = relogio(t, reduzMotion)');
    expect(frame).toContain('giroDaCorrente(t, S.p, S.mx, reduzMotion)');
    expect(frame).toContain('pulsoDaLuz(t, S.fim, reduzMotion)');
    // A declaracao e as tres chamadas de cima. Mais um `t` e deriva nova sem a preferencia.
    expect(usos).toHaveLength(4);
  });

  it('as derivas dos PNGs, das frases e das particulas andam no relogio', () => {
    expect(frame.match(/Math\.(?:sin|cos)\(tA\*/g)?.length).toBeGreaterThanOrEqual(10);
  });

  it('o mouse so entra pela paralaxe', () => {
    expect(frame.match(/S\.m[xy]/g)).toEqual(['S.my', 'S.mx']);
    expect(frame).toContain('paralaxe(S.my, reduzMotion)');
  });

  it('com movimento reduzido, so desenha quando a vigia manda', () => {
    expect(frame).toMatch(
      /if \(reduzMotion && !vigia\.precisaDesenhar\(poseDaCena\(\)\)\) return;\s*renderer\.render\(scene, camera\);\s*$/
    );
  });

  it('redimensionar a janela redesenha a cena parada', () => {
    expect(SCRIPT).toContain('renderer.setSize(innerWidth, innerHeight); vigia.invalida();');
  });
});

describe('script legado: vitrine', () => {
  const loop = corpo('loop', 'const vigiaDaVitrine');

  it('o flag que desenhava uma vez e nunca mais saiu', () => {
    expect(SCRIPT).not.toMatch(/\bdesenhou\b/);
  });

  it('com movimento reduzido, nada gira nem volta sozinho depois de solto', () => {
    expect(loop).toContain('if (!arrastando && !reduzMotion){');
    expect(loop).toContain('camisa.position.y = reduzMotion ? 0 :');
  });

  it('com movimento reduzido, so desenha quando a vigia manda', () => {
    expect(loop).toContain(
      'if (reduzMotion && !vigiaDaVitrine.precisaDesenhar(poseDaVitrine)) return;'
    );
  });

  it('o modelo que chega, o brasao e o canvas redimensionado redesenham', () => {
    expect(SCRIPT).toContain('camisa.clear(); camisa.add(m); vigiaDaVitrine.invalida();');
    expect(SCRIPT).toMatch(/TextureLoader\(\)\.load\([^\n]*vigiaDaVitrine\.invalida\(\)/);
    expect(corpo('redimensiona')).toMatch(
      /renderer\.setSize\(w, hgt, false\);[\s\S]*vigiaDaVitrine\.invalida\(\);/
    );
  });

  it('o modo fotos em GPU por software e o orcamento de quadro (#217) continuam', () => {
    expect(SCRIPT).toContain('if (querFotos()) init360(); else init();');
    expect(loop).toContain('if (agora - ultimoQuadro < Math.max(16, custo * 3)) return;');
  });
});
