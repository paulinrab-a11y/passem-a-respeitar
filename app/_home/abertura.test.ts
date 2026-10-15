// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  comoAbre,
  fechaAbertura,
  marcaAberturaVista,
  nevoaDaLinha,
  prendeAbertura,
} from './abertura';

/**
 * O estado "abertura fechada" (#238), que a intro do script legado e o
 * HomeRuntime precisam deixar igual: `#intro` fora, trava solta, barra
 * visivel. E, desde a #270, o fundo inerte enquanto a abertura esta na tela,
 * solto quando ela sai, com o foco que estava nela indo para a barra.
 */
function montaHome() {
  document.documentElement.className = 'locked';
  document.body.innerHTML = `
    <header id="bar"><button type="button" id="som">som</button></header>
    <div id="intro"><button type="button" id="skip">pular</button></div>
    <main><section id="merch"><a href="#merch">merch</a></section></main>
    <button type="button" id="abrirConcierge">concierge</button>
  `;
}

const intro = () => document.getElementById('intro') as HTMLElement;
const bar = () => document.getElementById('bar') as HTMLElement;
const main = () => document.querySelector('main') as HTMLElement;
const concierge = () => document.getElementById('abrirConcierge') as HTMLElement;
const som = () => document.getElementById('som') as HTMLButtonElement;
const skip = () => document.getElementById('skip') as HTMLButtonElement;

beforeEach(montaHome);

describe('prendeAbertura', () => {
  it('com a abertura na tela, a barra, a pagina e o concierge ficam inertes', () => {
    prendeAbertura(document);

    expect(bar().hasAttribute('inert')).toBe(true);
    expect(main().hasAttribute('inert')).toBe(true);
    expect(concierge().hasAttribute('inert')).toBe(true);
    expect(intro().hasAttribute('inert')).toBe(false);
  });

  it('abertura ja fechada nao prende nada', () => {
    fechaAbertura(document);
    prendeAbertura(document);

    expect(document.querySelectorAll('[inert]')).toHaveLength(0);
  });
});

describe('fechaAbertura', () => {
  it('tira a abertura da tela, solta a rolagem e mostra a barra', () => {
    fechaAbertura(document);

    expect(intro().classList.contains('out')).toBe(true);
    expect(intro().style.display).toBe('none');
    expect(document.documentElement.classList.contains('locked')).toBe(false);
    expect(bar().classList.contains('on')).toBe(true);
  });

  it('solta o fundo que a abertura prendeu', () => {
    prendeAbertura(document);
    fechaAbertura(document);

    expect(document.querySelectorAll('[inert]')).toHaveLength(0);
  });

  it('com o foco em pular, leva o foco para o som da barra', () => {
    prendeAbertura(document);
    skip().focus();

    fechaAbertura(document);

    expect(document.activeElement).toBe(som());
  });

  it('sem foco na abertura, nao poe foco em nada', () => {
    prendeAbertura(document);

    fechaAbertura(document);

    expect(document.activeElement).toBe(document.body);
  });

  it('fechar de novo nao desfaz nada: a timeline da intro pode terminar depois', () => {
    prendeAbertura(document);
    skip().focus();
    fechaAbertura(document);
    // A pessoa ja seguiu adiante quando a timeline termina.
    const merch = document.querySelector('#merch a') as HTMLAnchorElement;
    merch.focus();
    fechaAbertura(document);

    expect(intro().classList.contains('out')).toBe(true);
    expect(intro().style.display).toBe('none');
    expect(document.documentElement.classList.contains('locked')).toBe(false);
    expect(bar().classList.contains('on')).toBe(true);
    expect(document.activeElement).toBe(merch);
  });

  it('so mexe no que e da abertura: as outras classes da raiz ficam', () => {
    document.documentElement.className = 'locked sem-webgl';

    fechaAbertura(document);

    expect(document.documentElement.className).toBe('sem-webgl');
  });

  it('sem #intro nem #bar na pagina, solta a trava e nao lanca', () => {
    document.body.innerHTML = '<main></main>';

    expect(() => fechaAbertura(document)).not.toThrow();
    expect(document.documentElement.classList.contains('locked')).toBe(false);
  });
});

/**
 * O desfoque da entrada do manifesto sem animar `filter` (#286): uma copia
 * borrada, parada, embaixo da linha nitida. A timeline so troca a opacidade
 * das duas; o que se confere aqui e a copia.
 */
describe('nevoaDaLinha', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="manifesto" aria-live="polite">
        <span class="l" id="primeira"><span class="nitida">Não são seguidores.</span></span>
        <span class="l fim" id="fim"><span class="nitida"><img src="/logo.png" alt="" id="logoDoFim"><span>Passem a respeitar</span></span></span>
        <span class="l" id="crua">Sem camada.</span>
      </div>`;
  });

  const linha = (id: string) => document.getElementById(id) as HTMLElement;

  /** O texto da linha que sobra para o leitor de tela: sem o que e aria-hidden. */
  const textoLido = (el: HTMLElement) => {
    const copia = el.cloneNode(true) as HTMLElement;
    for (const escondido of copia.querySelectorAll('[aria-hidden="true"]')) escondido.remove();
    return copia.textContent;
  };

  it('monta a copia dentro da linha, depois da nitida e com o mesmo texto', () => {
    const camadas = nevoaDaLinha(linha('primeira'));

    expect(camadas?.nitida.className).toBe('nitida');
    expect(camadas?.nevoa.className).toBe('nevoa');
    expect(camadas?.nevoa.parentElement).toBe(linha('primeira'));
    expect(camadas?.nevoa.previousElementSibling).toBe(camadas?.nitida);
    expect(camadas?.nevoa.textContent).toBe('Não são seguidores.');
  });

  it('o leitor de tela continua lendo a linha uma vez so', () => {
    nevoaDaLinha(linha('primeira'));
    nevoaDaLinha(linha('fim'));

    expect(textoLido(linha('primeira'))).toBe('Não são seguidores.');
    expect(textoLido(linha('fim'))).toBe('Passem a respeitar');
  });

  it('a copia ja entra escondida do leitor: o manifesto e aria-live', async () => {
    const registros: MutationRecord[] = [];
    const observa = new MutationObserver((r) => registros.push(...r));
    observa.observe(document.getElementById('manifesto') as HTMLElement, {
      subtree: true,
      childList: true,
      attributes: true,
    });

    const camadas = nevoaDaLinha(linha('primeira'));
    await Promise.resolve();
    registros.push(...observa.takeRecords());
    observa.disconnect();

    // Uma entrada so, com o aria-hidden ja posto: nenhum atributo mudou depois.
    expect(registros.map((r) => r.type)).toEqual(['childList']);
    expect([...registros[0].addedNodes]).toEqual([camadas?.nevoa]);
    expect(camadas?.nevoa.getAttribute('aria-hidden')).toBe('true');
  });

  it('a copia do fim leva o logo, sem repetir id', () => {
    const camadas = nevoaDaLinha(linha('fim'));

    expect(camadas?.nevoa.querySelector('img')?.getAttribute('src')).toBe('/logo.png');
    expect(camadas?.nevoa.querySelector('[id]')).toBeNull();
    expect(document.querySelectorAll('#logoDoFim')).toHaveLength(1);
  });

  it('chamar de novo devolve a mesma copia, sem montar outra', () => {
    const antes = nevoaDaLinha(linha('primeira'));
    const depois = nevoaDaLinha(linha('primeira'));

    expect(depois?.nevoa).toBe(antes?.nevoa);
    expect(linha('primeira').querySelectorAll('.nevoa')).toHaveLength(1);
  });

  it('linha sem a camada nitida fica como esta', () => {
    expect(nevoaDaLinha(linha('crua'))).toBeNull();
    expect(linha('crua').innerHTML).toBe('Sem camada.');
  });
});

/**
 * A abertura inteira so na primeira vez da aba (#344). A intro leva uns 15 s,
 * e rodava em toda carga: na volta do checkout, no recarregar, na chegada por
 * ancora.
 */
describe('comoAbre', () => {
  beforeEach(() => {
    document.body.innerHTML = '<main><section id="merch"></section></main>';
    sessionStorage.clear();
    history.replaceState(null, '', '/');
  });
  afterEach(() => {
    vi.restoreAllMocks();
    history.replaceState(null, '', '/');
  });

  it('primeira vez na aba: abertura completa', () => {
    expect(comoAbre(window)).toBe('completa');
  });

  it('depois de fechar uma vez: reprise curta', () => {
    marcaAberturaVista(window);

    expect(sessionStorage.getItem('par:intro')).toBe('1');
    expect(comoAbre(window)).toBe('reprise');
  });

  it('com ancora que existe na pagina: nenhuma, mesmo na primeira vez', () => {
    history.replaceState(null, '', '/#merch');

    expect(comoAbre(window)).toBe('nenhuma');
  });

  it('ancora que nao existe, ou so `#`, nao conta', () => {
    history.replaceState(null, '', '/#nada-aqui');
    expect(comoAbre(window)).toBe('completa');

    history.replaceState(null, '', '/#');
    expect(comoAbre(window)).toBe('completa');
  });

  it('storage bloqueado: abertura completa, e anotar nao lanca', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('bloqueado', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('bloqueado', 'SecurityError');
    });

    expect(() => marcaAberturaVista(window)).not.toThrow();
    expect(comoAbre(window)).toBe('completa');
  });
});

describe('intro do script legado (#344)', () => {
  const SCRIPT = readFileSync('app/_home/legacy-site.js', 'utf8');
  const intro = SCRIPT.slice(SCRIPT.indexOf('(function intro(){'), SCRIPT.indexOf('const Loja'));

  it('anota a abertura vista no mesmo fecha() das tres saidas', () => {
    const inicio = intro.indexOf('function fecha(){');
    const fecha = intro.slice(inicio, intro.indexOf('\n  }\n', inicio));

    expect(fecha).toContain('fechaAbertura(document);');
    expect(fecha).toContain('marcaAberturaVista(window);');
  });

  it('por ancora nao trava nem rola ao topo; reprise e um fade curto', () => {
    const nenhuma = intro.indexOf("if (modo === 'nenhuma')");
    expect(nenhuma).toBeGreaterThan(-1);
    expect(nenhuma).toBeLessThan(intro.indexOf("html.classList.add('locked')"));
    expect(intro).toMatch(
      /modo === 'reprise'\)\{[\s\S]*?tl\.to\(el, \{ opacity:0, duration:\.4, ease:'power2\.out', onComplete: fecha \}\)/
    );
  });

  it('o prazo de 19 s fecha com fade de 300 ms e uma rede para aba parada', () => {
    const prazo = intro.slice(intro.indexOf('setTimeout(()=>{'), intro.indexOf('}, 19000);'));

    expect(prazo).toContain(
      "gsap.to(el, { opacity:0, duration:.3, ease:'power2.out', onComplete: fecha });"
    );
    expect(prazo).toContain('setTimeout(fecha, 400);');
  });
});
