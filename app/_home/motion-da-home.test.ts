// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ligaComprar } from './comprar';

/**
 * O que a auditoria de motion de 15/10 achou no script da home (#347) e nao
 * pode voltar. Nenhum teste automatico ve animacao (AGENTS.md); o que se
 * segura aqui e a regra no codigo.
 */
const SCRIPT = readFileSync('app/_home/legacy-site.js', 'utf8');

/** O trecho entre dois marcadores do script. */
const trecho = (de: string, ate: string) => {
  const ini = SCRIPT.indexOf(de);
  expect(ini).toBeGreaterThan(-1);
  return SCRIPT.slice(ini, SCRIPT.indexOf(ate, ini));
};

describe('cena principal pausa atras dos modais', () => {
  it('o frame para de pedir quadro enquanto ha dono pausando', () => {
    const frame = trecho('function frame(now){', 'const dt =');

    expect(frame).toMatch(
      /^function frame\(now\)\{\n {4}if \(pausas\.size\)\{ rodando = false; return; \}/
    );
  });

  it('voltar religa um laco so, sem contar o tempo parado', () => {
    const pausa = trecho('function pausa(dono, sim){', 'function frame(now){');

    expect(pausa).toContain('if (pausas.size || rodando) return;');
    expect(pausa).toContain('tPrev = performance.now(); vigia.invalida();');
    expect(pausa).toContain('requestAnimationFrame(frame);');
  });

  it('loja e sala pausam ao abrir e soltam no fim da saida, cada uma com o seu nome', () => {
    expect(SCRIPT).toContain("GL.pausa('loja', true);");
    expect(SCRIPT).toContain("fotos.para(); GL.pausa('loja', false); });");
    expect(SCRIPT).toContain("modalAnimado(sala, ()=> GL.pausa('sala', false));");
    expect(SCRIPT).toContain("GL.pausa('sala', true);");
  });

  it('sem WebGL a pausa existe e nao faz nada', () => {
    expect(trecho('function semWebGL(erro){', 'const GL =')).toContain('pausa(){}');
  });
});

describe('lerps pelo tempo do quadro', () => {
  const frame = trecho('function frame(now){', 'function ease(x)');

  it('camera, PNGs e frases usam `passo`, nao fator fixo por quadro', () => {
    expect(frame).toContain('const kCam = passo(0.08, dt), kOp = passo(0.06, dt);');
    expect(frame).not.toMatch(/\)\s*\*\s*0\.0[68];/);
    expect(frame).toContain('S.shake *= Math.pow(0.9, dt*60);');
  });

  it('a vitrine gira pelo tempo, nao por quadro', () => {
    const loop = trecho('  function loop(){', '  let giro = null');

    expect(loop).toContain('velY *= Math.pow(0.92, f); rotY += (velY + 0.004) * f;');
    expect(loop).toContain('passo(0.03, dt)');
  });

  it('o timecode da intro conta pelo relogio', () => {
    const tc = trecho("const tc = $('#tc')", 'const c=$');

    expect(tc).toContain('Math.floor((performance.now() - t0) * 0.03)');
    expect(tc).not.toContain('fr++');
  });

  it('as particulas param de verdade quando o fim apaga', () => {
    expect(frame).toContain('if (S.fim > 0.001 || pMat.opacity > 0.002){');
    expect(frame).toContain('pMat.opacity = op > 0.002 ? op : 0;');
  });
});

describe('pequenas saidas e o toque', () => {
  it('"ligar o som" sai com fade de 150 ms, sem corte seco', () => {
    expect(SCRIPT).toContain(
      "gsap.to('#ligar', { opacity:0, duration:.15, ease:'power2.out', overwrite:true });"
    );
    expect(SCRIPT).not.toContain("$('#ligar').style.opacity=0");
  });

  it('o tick do som so toca para mouse', () => {
    const tick = trecho("document.addEventListener('pointerover'", "$('#tocando')");

    expect(tick).toContain("if (e.pointerType !== 'mouse') return;");
    expect(SCRIPT).not.toContain("addEventListener('mouseover'");
  });
});

describe('vitrine', () => {
  it('troca silhueta pelo modelo com fade de 250 ms, direto com movimento reduzido', () => {
    const troca = trecho('function trocaPeloModelo(m){', '  function andaTroca(');
    const anda = trecho('function andaTroca(agora){', '  function init(){');

    expect(troca).toContain(
      'if (reduzMotion || !aberto){ camisa.clear(); camisa.add(m); vigiaDaVitrine.invalida(); return; }'
    );
    expect(anda).toContain('(agora - troca.ini) / 250');
    expect(anda).toContain('troca.velhos.forEach(o=> camisa.remove(o));');
  });
});

describe('tamanho escolhido antes do Comprar', () => {
  it('nenhum tamanho vem do servidor como padrao', () => {
    expect(SCRIPT).not.toContain('dataset.padrao');
  });

  it('sem tamanho o Comprar da loja perde o destino e diz o que falta', () => {
    const link = trecho('  const link = ()=>{\n    const slug', "  $('#tamLoja').addEventListener");

    expect(link).toContain("a.removeAttribute('href'); a.setAttribute('aria-disabled', 'true');");
    expect(link).toContain("a.classList.toggle('off', !pode);");
    expect(link).toContain("rotulo.toggleAttribute('data-ativo', Boolean(slug) && !tam);");
  });

  it('o clique no Comprar sem destino nao navega nem fecha a loja', () => {
    document.body.innerHTML = '<a id="c" aria-disabled="true">Comprar</a>';
    const a = document.getElementById('c') as HTMLAnchorElement;
    let fechou = false;
    ligaComprar(a, () => {
      fechou = true;
    });

    const clique = new MouseEvent('click', { bubbles: true, cancelable: true });
    a.dispatchEvent(clique);

    expect(clique.defaultPrevented).toBe(true);
    expect(fechou).toBe(false);
  });
});
