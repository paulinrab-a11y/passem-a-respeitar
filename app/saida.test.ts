import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Saida animada (#49). Os criterios da issue, lidos do CSS e do script:
 *
 *   - nada some de uma vez: modal, toast, confirmacao e troca de rota tem saida
 *   - a saida e mais rapida que a entrada
 *   - Esc fecha pelo mesmo caminho do botao
 *   - o foco volta para quem abriu
 *   - com movimento reduzido, fade
 */
const CSS = readFileSync('app/globals.css', 'utf8');
const SCRIPT = readFileSync('app/_home/legacy-site.js', 'utf8');

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

const emMs = (valor: string) =>
  valor.endsWith('ms') ? Number.parseFloat(valor) : Number.parseFloat(valor) * 1000;

/** Duracoes de cada animacao em uso, pelo nome do keyframe. */
function duracoes(nome: string): number[] {
  return [...CSS.matchAll(new RegExp(`animation:${nome} ([\\d.]+m?s)`, 'g'))].map((m) =>
    emMs(m[1])
  );
}

describe('a saida e mais rapida que a entrada', () => {
  const PARES = [
    'modal',
    'modal-caixa',
    'toast',
    'menu-conta',
    'conta-confirma',
    'excluir',
    'sessao',
    'rota',
  ];

  it.each(PARES)('%s', (prefixo) => {
    const entrada = duracoes(`${prefixo}-entra`);
    const saida = duracoes(`${prefixo}-sai`);

    expect(entrada.length, `${prefixo}-entra em uso`).toBeGreaterThan(0);
    expect(saida.length, `${prefixo}-sai em uso`).toBeGreaterThan(0);
    expect(Math.max(...saida)).toBeLessThan(Math.min(...entrada));
  });

  it.each(PARES)('%s-sai so mexe em opacity e transform', (prefixo) => {
    const corpos = [
      ...CSS.matchAll(new RegExp(`@keyframes ${prefixo}-sai\\{((?:[^{}]*\\{[^{}]*\\})*)\\}`, 'g')),
    ].map((m) => m[1]);

    expect(corpos.length).toBeGreaterThan(0);
    for (const corpo of corpos) {
      const propriedades = [...corpo.matchAll(/(?:\{|;)\s*([a-z-]+)\s*:/g)].map((m) => m[1]);
      expect(propriedades.filter((p) => p !== 'opacity' && p !== 'transform')).toEqual([]);
    }
  });

  it('entrada e saida usam a curva do projeto, nao ease padrao', () => {
    const usos = [...CSS.matchAll(/animation:[a-z-]+-(?:entra|sai) [\d.]+m?s ([^;}]+)/g)].map(
      (m) => m[1]
    );

    expect(usos.length).toBeGreaterThan(15);
    expect(usos.filter((u) => !u.startsWith('cubic-bezier('))).toEqual([]);
  });
});

describe('troca de rota', () => {
  it('a transicao e a de documento, sem JavaScript', () => {
    expect(CSS).toContain('@view-transition{navigation:auto}');
    expect(CSS).toMatch(/::view-transition-old\(root\)\{animation:rota-sai /);
    expect(CSS).toMatch(/::view-transition-new\(root\)\{animation:rota-entra /);
  });

  it('e so fade: nada desliza nem escala entre paginas', () => {
    expect(CSS).toContain('@keyframes rota-sai{from{opacity:1}to{opacity:0}}');
    expect(CSS).toContain('@keyframes rota-entra{from{opacity:0}to{opacity:1}}');
  });
});

describe('modais da home', () => {
  it.each(['#sala', '#loja'])('%s tem entrada e saida no CSS', (id) => {
    expect(CSS).toMatch(new RegExp(`${id}\\.on[^{]*\\{animation:modal-entra `));
    expect(CSS).toMatch(new RegExp(`${id}\\.saindo[^{]*\\{animation:modal-sai `));
    expect(CSS).toMatch(new RegExp(`${id}\\.saindo>\\.in[^{]*\\{animation:modal-caixa-sai `));
  });

  it('modal saindo nao recebe clique', () => {
    expect(CSS).toMatch(/#sala\.saindo,#loja\.saindo\{[^}]*pointer-events:none/);
  });

  /** O corpo de uma funcao, contando chaves. */
  function corpo(assinatura: string): string {
    const ini = SCRIPT.indexOf(assinatura);
    expect(ini, assinatura).toBeGreaterThan(-1);
    let i = SCRIPT.indexOf('{', ini + assinatura.length - 1) + 1;
    const comeco = i;
    for (let fundo = 1; i < SCRIPT.length && fundo > 0; i++) {
      if (SCRIPT[i] === '{') fundo++;
      else if (SCRIPT[i] === '}') fundo--;
    }
    return SCRIPT.slice(comeco, i - 1);
  }

  it('fechar so poe `saindo`; quem tira o `on` e o fim da animacao', () => {
    const helper = corpo('function modalAnimado(el, aoTerminar){');

    expect(helper).toContain("el.classList.add('saindo')");
    expect(helper).toContain("el.addEventListener('animationend'");
    // `on` so sai dentro de `termina`.
    expect(helper.match(/classList\.remove\('on'/g)).toHaveLength(1);
    expect(corpo('const termina = ()=>{')).toContain("el.classList.remove('on', 'saindo')");
  });

  it('ninguem fecha modal tirando a classe na mao', () => {
    const fora = SCRIPT.replace(corpo('function modalAnimado(el, aoTerminar){'), '');

    expect(fora).not.toMatch(/(?:sala|el)\.classList\.remove\('on'\)/);
    expect(fora).not.toMatch(/(?:sala|el)\.classList\.add\('on'\)/);
  });

  it('ha prazo para o caso de a animacao nao terminar', () => {
    expect(corpo('function modalAnimado(el, aoTerminar){')).toMatch(
      /prazo = setTimeout\(termina, \d+\)/
    );
  });

  it('Esc fecha pelo mesmo caminho do botao', () => {
    const escs = [...SCRIPT.matchAll(/e\.key\s*===\s*'Escape'\)\s*([^;}]+)/g)].map((m) =>
      m[1].trim()
    );

    expect(escs.sort()).toEqual(['fecha()', 'modal.fecha()']);
    expect(SCRIPT).toContain("$('#fecharSala').addEventListener('click', ()=> modal.fecha());");
    expect(SCRIPT).toContain("$('#fecharLoja').addEventListener('click', fecha);");
  });

  it('o foco volta para quem abriu', () => {
    const termina = corpo('const termina = ()=>{');

    expect(termina).toContain('quemAbriu.focus({ preventScroll:true })');
    // Quem abriu pode ter saido da pagina enquanto o modal estava aberto.
    expect(termina).toContain('document.contains(quemAbriu)');
    // A loja recebe o botao que a abriu; a sala, o campo do codigo.
    expect(SCRIPT).toContain('Loja.abre(tam, e.currentTarget)');
    expect(SCRIPT).toContain('modal.abre(inp)');
  });

  it('a trava de rolagem da loja so cai no fim da saida', () => {
    expect(SCRIPT).toContain(
      "modalAnimado(el, ()=>{ aberto = false; document.documentElement.classList.remove('locked'); })"
    );
  });
});

describe('movimento reduzido vira fade', () => {
  it('nenhuma saida usa mais o truque da duracao quase zero', () => {
    expect(REDUZIDO).not.toContain('.01ms');
  });

  it.each([
    ['.toast', 'so-fade'],
    ['.toast.saindo', 'so-fade-sai'],
    ['.conta-confirma', 'so-fade'],
    ['.conta-confirma.saindo', 'so-fade-sai'],
    ['.excluir-caixa', 'so-fade'],
    ['.excluir-caixa.saindo', 'so-fade-sai'],
    ['.sessoes li.saindo', 'so-fade-sai'],
    ['#sala.saindo>.in,#loja.saindo>.in', 'so-fade-sai'],
  ])('%s usa %s', (seletor, animacao) => {
    expect(REDUZIDO).toContain(`${seletor}{animation-name:${animacao}}`);
  });

  it('os dois keyframes de fade so mexem em opacidade', () => {
    expect(CSS).toContain('@keyframes so-fade{from{opacity:0}to{opacity:1}}');
    expect(CSS).toContain('@keyframes so-fade-sai{from{opacity:1}to{opacity:0}}');
  });
});
