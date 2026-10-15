import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * A cena 3D da home sem travar o carregamento (#377).
 *
 * Medido antes: uma tarefa longa de ~2 s logo depois da hidratacao, com a
 * primeira pintura esperando por ela. O que segura isso nao aparece em lint,
 * typecheck nem build — so no perfil do navegador. Estas sao as invariantes
 * que o seguram, lidas do codigo.
 */
const SCRIPT = readFileSync('app/_home/legacy-site.js', 'utf8');
const RUNTIME = readFileSync('app/_home/HomeRuntime.tsx', 'utf8');
const HOME = readFileSync('app/page.tsx', 'utf8');

describe('cena da home', () => {
  it('os dois renderers nao esperam o driver a cada shader em producao', () => {
    const conferencia = "renderer.debug.checkShaderErrors = process.env.NODE_ENV !== 'production';";
    expect(SCRIPT.split(conferencia)).toHaveLength(3);
  });

  it('a cena monta por etapas, na ordem: fundo, corrente, particulas, frases, elementos', () => {
    expect(SCRIPT).toContain(
      'etapas = [fundoDesfoque, fundoShader, fundo, montaCorrente, montaSombras, particulas, ligaQuadro, frasesComAFonte, elementos];'
    );
    // Uma tarefa por etapa, e a primeira ja fora do init.
    expect(SCRIPT).toMatch(/function proximaEtapa\(\)\{[\s\S]*?setTimeout\(proximaEtapa, 0\);/);
    expect(SCRIPT.match(/setTimeout\(proximaEtapa, 0\);/g)).toHaveLength(2);
  });

  it('etapa que lanca cai no mesmo caminho da cena sem WebGL, e o quadro para', () => {
    expect(SCRIPT).toContain(
      "try { fn(); } catch (erro) { pausas.add('falha'); semWebGL(erro); return; }"
    );
  });

  it('cada etapa com shader compila na propria tarefa, sem desenhar', () => {
    for (const etapa of ['montaCorrente', 'montaSombras', 'particulas']) {
      const ini = SCRIPT.indexOf(`function ${etapa}(){`);
      const fim = SCRIPT.indexOf('\n  }\n', ini);
      expect(SCRIPT.slice(ini, fim), etapa).toContain('renderer.compile(scene, camera);');
    }
    expect(SCRIPT).toMatch(
      /function frasesComAFonte\(\)\{[^\n]*renderer\.compile\(scene, camera\)/
    );
  });

  it('o primeiro quadro so sai com a corrente inteira na cena', () => {
    expect(SCRIPT).toContain('function ligaQuadro(){ requestAnimationFrame(frame); }');
    // Fora da etapa, o laco nao e ligado antes da hora.
    const fimDoQuadro = SCRIPT.indexOf('function ease(x)');
    const depois = SCRIPT.slice(fimDoQuadro, SCRIPT.indexOf("addEventListener('resize'"));
    expect(depois).not.toContain('requestAnimationFrame(frame)');
  });
});

describe('runtime da home', () => {
  it('o init espera a pagina pintar, com os chunks ja baixando', () => {
    expect(RUNTIME).toContain("import { depoisDaPintura } from './depois-da-pintura';");
    expect(RUNTIME).toMatch(
      /await Promise\.all\(\[\s*Promise\.all\(\[\s*import\('three'\)[\s\S]*?\]\),\s*depoisDaPintura\(window\),\s*\]\);/
    );
  });
});

describe('logo do hero', () => {
  it('sai na frente da fila de rede', () => {
    const logo = HOME.slice(HOME.indexOf('<h1 id="logoHero">'), HOME.indexOf('</h1>'));
    expect(logo).toContain('priority');
    expect(logo).toContain('fetchPriority="high"');
  });
});
