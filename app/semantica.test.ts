import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Semantica do seletor de tamanho e dos canvas decorativos (#59).
 *
 * O lint ja pega o que e erro de marcacao. O que ele nao pega e o que estes
 * testes seguram: o visual do <fieldset> zerado, o contrato com o script
 * legado, e o nome de classe que nao pode colidir.
 */
const HOME = readFileSync('app/page.tsx', 'utf8');
const CSS = readFileSync('app/globals.css', 'utf8');
const SCRIPT = readFileSync('app/_home/legacy-site.js', 'utf8');

/** O bloco do <fieldset> com o id pedido. */
function seletor(id: string): string {
  const onde = HOME.indexOf(`id="${id}"`);
  const abre = HOME.lastIndexOf('<fieldset', onde);
  const fecha = HOME.indexOf('</fieldset>', onde);

  expect(abre, `<fieldset> de ${id}`).toBeGreaterThan(-1);
  expect(fecha, `</fieldset> de ${id}`).toBeGreaterThan(onde);
  return HOME.slice(abre, fecha);
}

describe.each(['tamanhos', 'tamLoja'])('seletor de tamanho #%s', (id) => {
  it('e um fieldset com legenda, e nao um div com role', () => {
    const bloco = seletor(id);

    expect(bloco).toContain('className="tam"');
    expect(bloco).not.toContain('role="group"');
    expect(bloco).not.toContain('aria-label');
  });

  it('a legenda e a primeira coisa dentro dele, escondida de quem ve', () => {
    expect(seletor(id)).toMatch(/^<fieldset[^>]*>\s*<legend className="sr">Tamanho<\/legend>/);
  });

  it('mantem o que o script legado le: data-padrao, data-slug e button[data-t]', () => {
    const bloco = seletor(id);

    expect(bloco).toContain('data-padrao={tamanhoPadrao}');
    expect(bloco).toContain("data-slug={camiseta?.slug ?? ''}");
    expect(bloco).toMatch(/<button[\s\S]*?data-t=\{v\.tamanho \?\? ''\}/);
    expect(bloco).toContain("className={v.tamanho === tamanhoPadrao ? 'on' : undefined}");
  });

  it('o botao escolhido diz que esta escolhido, alem de mudar de cor', () => {
    expect(seletor(id)).toContain('aria-pressed={v.tamanho === tamanhoPadrao}');
  });
});

describe('script legado', () => {
  it('continua achando os botoes pelos mesmos seletores', () => {
    expect(SCRIPT).toContain("$$('#tamanhos button')");
    expect(SCRIPT).toContain("$$('#tamLoja button')");
    expect(SCRIPT).toContain("$('#tamanhos').addEventListener('click'");
    expect(SCRIPT).toContain("$('#tamLoja').addEventListener('click'");
  });

  it('toda troca de classe `on` nos tamanhos leva o aria-pressed junto', () => {
    const trocas = [
      ...SCRIPT.matchAll(/\$\$\('#tam(?:anhos|Loja) button'\)\.forEach\(([^\n]*)/g),
    ].map((m) => m[1]);

    expect(trocas).toHaveLength(3);
    for (const troca of trocas) {
      expect(troca).toContain("classList.toggle('on'");
      expect(troca).toContain("setAttribute('aria-pressed'");
    }
  });
});

describe('fieldset sem cara de fieldset', () => {
  it('zera borda, recuo, margem e largura minima', () => {
    expect(CSS).toContain('fieldset.tam{border:0;padding:0;margin:0;min-width:0}');
  });

  it('a regra que zera vem ANTES das que dao a margem de cada seletor', () => {
    const zera = CSS.indexOf('fieldset.tam{');

    expect(zera).toBeLessThan(CSS.indexOf('#merch .tam{margin-top'));
    expect(zera).toBeLessThan(CSS.indexOf('#loja .tam{margin-top'));
  });

  it('a legenda usa a classe que ja escondia texto no site', () => {
    expect(CSS).toMatch(/(?:^|\n)\.sr\{position:absolute;width:1px;height:1px;overflow:hidden/);
  });
});

describe('canvas decorativos', () => {
  it('ficam fora da arvore de acessibilidade por um elemento em volta', () => {
    expect(HOME).toMatch(
      /<div aria-hidden="true">\s*<canvas id="gl"><\/canvas>\s*<canvas id="grain"[^>]*><\/canvas>\s*<\/div>/
    );
  });

  it('nenhum canvas carrega aria-hidden, role ou tabindex', () => {
    const canvas = [...HOME.matchAll(/<canvas\b[^>]*>/g)].map((m) => m[0]);

    expect(canvas.length).toBeGreaterThanOrEqual(4);
    expect(canvas.filter((c) => /aria-hidden|role=|tabIndex/.test(c))).toEqual([]);
  });

  it('os dois sao de posicao fixa: o elemento em volta nao ocupa espaco', () => {
    expect(CSS).toMatch(/(?:^|\n)#gl\{position:fixed;/);
    expect(CSS).toMatch(/(?:^|\n)#grain\{position:fixed;/);
  });
});

describe('supressoes de lint', () => {
  it('as duas da #59 sairam da home', () => {
    expect(HOME).not.toContain('useSemanticElements');
    expect(HOME).not.toContain('noAriaHiddenOnFocusable');
  });

  it('as que sobraram sao so as dos links que o script preenche', () => {
    const regras = [...HOME.matchAll(/biome-ignore lint\/([\w/]+)/g)].map((m) => m[1]);

    expect([...new Set(regras)]).toEqual(['a11y/useValidAnchor']);
  });
});

describe('nomes de classe que nao podem colidir', () => {
  it('`rotulo` e do texto "tamanho" da loja; o rotulo de botao e `rotulo-acao`', () => {
    expect(HOME).toMatch(/<div className="rotulo" aria-hidden="true">\s*tamanho\s*<\/div>/);
    expect(readFileSync('app/_ui/Rotulo.tsx', 'utf8')).toContain('className="rotulo-acao"');
  });

  it('nenhuma regra global pega a classe `rotulo` sozinha', () => {
    const globais = [...CSS.matchAll(/(?:^|\n)\s*(\.rotulo(?![\w-])[^{\n]*)\{/g)].map((m) => m[1]);

    expect(globais).toEqual([]);
  });

  it('a regra do texto da loja continua valendo', () => {
    expect(CSS).toMatch(/#loja \.rotulo\{margin-top:24px;/);
  });
});
