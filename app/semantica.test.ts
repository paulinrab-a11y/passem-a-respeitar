// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import Checkout from './checkout/page';
import Home from './page';

/**
 * Semantica do seletor de tamanho e dos canvas decorativos (#59), e do HTML
 * que o servidor entrega (#266).
 *
 * O lint ja pega o que e erro de marcacao. O que ele nao pega e o que estes
 * testes seguram: o visual do <fieldset> zerado, o contrato com o script
 * legado, o nome de classe que nao pode colidir, e o aninhamento que o parser
 * do navegador desfaz.
 */

// Ambiente jsdom so pelo DOMParser e pelo parser de HTML. As paginas sao
// renderizadas com dados fixos: o que se mede e a marcacao, nao o banco.
const { GUIA, LINHA } = vi.hoisted(() => ({
  GUIA: [
    { tamanho: 'P', altura: 79, largura: 67, manga: 23 },
    { tamanho: 'M', altura: 81, largura: 70, manga: 24 },
  ],
  LINHA: {
    produtoSlug: 'camiseta-cbac',
    nome: 'Camiseta CBAC',
    tamanho: 'M',
    quantidade: 1,
    precoUnitarioCentavos: 12000,
    subtotalCentavos: 12000,
  },
}));

vi.mock('@/lib/supabase/servidor', () => ({ usuarioDaSessao: async () => ({ id: 'pessoa' }) }));
vi.mock('@/lib/loja/catalogo', () => ({
  orcamento: async () => ({
    ok: true,
    linhas: [LINHA],
    subtotalCentavos: 12000,
    frete: null,
    totalCentavos: 12000,
  }),
  fichaDoCheckout: async () => ({ tamanhos: ['P', 'M'], guia: GUIA }),
  vitrine: async () => [
    {
      slug: LINHA.produtoSlug,
      nome: LINHA.nome,
      descricao: 'Camiseta oversized.',
      variacoes: ['P', 'M'].map((tamanho) => ({ tamanho, precoCentavos: 12000 })),
      precoCentavos: 12000,
      guia: GUIA,
    },
  ],
}));
// O seletor de tamanho e quantidade do checkout (#356) pede o roteador; fora
// do App Router nao ha um, e a marcacao e o que se mede aqui.
vi.mock('next/navigation', async (original) => ({
  ...(await original<typeof import('next/navigation')>()),
  useRouter: () => ({ replace: () => {} }),
}));
vi.mock('@/app/checkout/acoes', () => ({
  finalizarCompra: vi.fn(),
  cotarFrete: vi.fn(),
  buscarEndereco: vi.fn(),
}));
vi.mock('@/app/_home/acoes', () => ({ cotarFreteNaFicha: vi.fn() }));
vi.mock('@/app/conta/acoes', () => ({ sair: vi.fn() }));

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

  it('mantem o que o script legado le: data-slug e button[data-t]', () => {
    const bloco = seletor(id);

    expect(bloco).toContain("data-slug={camiseta?.slug ?? ''}");
    expect(bloco).toMatch(/<button[\s\S]*?data-t=\{v\.tamanho \?\? ''\}/);
  });

  // #347: era M para todo mundo, e quem nao olhava levava M sem escolher.
  it('nenhum tamanho nasce escolhido', () => {
    const bloco = seletor(id);

    expect(bloco).not.toContain('data-padrao');
    expect(bloco).not.toMatch(/className=\{v\.tamanho/);
    expect(bloco).toContain('aria-pressed={false}');
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

/**
 * O HTML que o servidor manda, lido duas vezes (#266).
 *
 * Como XML, ele e a arvore que o JSX escreveu, sem correcao nenhuma. Pelo
 * parser de HTML, e a arvore que o navegador monta. Se as duas divergem, o
 * navegador reorganizou alguma coisa (um <dialog> dentro de <p> fecha o <p>
 * antes da hora), e a hidratacao do React encontra outra pagina: erro no
 * console, re-render no cliente e um evento no Sentry a cada visita.
 */
function comoEscrito(html: string): Element {
  // O React poe um <script> inline junto de formulario com acao (o replay do
  // envio feito antes da hidratacao). Conteudo de script e texto cru no HTML e
  // vira CDATA aqui, para o `&&` dele nao ser lido como entidade.
  const xml = html.replace(
    /<(script|style)\b([^>]*)>([\s\S]*?)<\/\1>/g,
    '<$1$2><![CDATA[$3]]></$1>'
  );
  const doc = new DOMParser().parseFromString(`<raiz>${xml}</raiz>`, 'application/xml');
  expect(doc.querySelector('parsererror'), 'markup do React lido como XML').toBeNull();
  return doc.documentElement;
}

function comoONavegadorLe(html: string): Element {
  const raiz = document.implementation.createHTMLDocument('').createElement('div');
  raiz.innerHTML = html;
  return raiz;
}

/** Uma linha por elemento, recuada pela profundidade. Texto nao entra. */
function estrutura(raiz: Element): string[] {
  const linhas: string[] = [];
  const anda = (el: Element, nivel: number) => {
    linhas.push(`${'  '.repeat(nivel)}${el.localName.toLowerCase()}`);
    for (const filho of el.children) anda(filho, nivel + 1);
  };
  for (const filho of raiz.children) anda(filho, 0);
  return linhas;
}

function confereArvore(html: string) {
  const escrita = estrutura(comoEscrito(html));

  // Piso para o teste nao passar comparando duas arvores vazias.
  expect(escrita.length).toBeGreaterThan(50);
  expect(estrutura(comoONavegadorLe(html))).toEqual(escrita);
}

const checkout = async () =>
  renderToStaticMarkup(
    await Checkout({ searchParams: Promise.resolve({ p: LINHA.produtoSlug, tam: 'M', q: '1' }) })
  );

describe('checkout renderizado', () => {
  it('o navegador monta a mesma arvore que o React escreveu', async () => {
    confereArvore(await checkout());
  });

  it('nenhum <dialog> dentro de <p>', async () => {
    const escrito = comoEscrito(await checkout());

    expect(escrito.querySelectorAll('dialog')).toHaveLength(1);
    expect(escrito.querySelectorAll('p dialog')).toHaveLength(0);
  });

  // #356: trocar o tamanho e no proprio checkout, e o link de volta para a
  // home saiu. Sobra o guia na linha dele.
  it('a linha do guia tem o botao e o dialog, e nada que leve de volta a home', async () => {
    const linha = comoONavegadorLe(await checkout()).querySelector('.guia-no-checkout');
    const filhos = [...(linha?.children ?? [])].map((el) => el.localName);

    expect(filhos).toEqual(['button', 'dialog']);
    expect((await checkout()).includes('href="/#merch">Trocar')).toBe(false);
  });

  it('tamanho e quantidade sao grupos de radios com legenda, com a escolha da URL marcada', async () => {
    const pagina = comoONavegadorLe(await checkout());
    const grupos = [...pagina.querySelectorAll('.checkout-escolha fieldset')];

    expect(grupos.map((g) => g.firstElementChild?.textContent)).toEqual(['Tamanho', 'Quantidade']);

    const tamanhos = [...grupos[0].querySelectorAll('input[type="radio"]')] as HTMLInputElement[];
    expect(tamanhos.map((r) => r.value)).toEqual(['P', 'M']);
    expect(tamanhos.filter((r) => r.checked).map((r) => r.value)).toEqual(['M']);

    const quantidades = [
      ...grupos[1].querySelectorAll('input[type="radio"]'),
    ] as HTMLInputElement[];
    expect(quantidades.map((r) => r.value)).toEqual(['1', '2', '3']);
    expect(quantidades.filter((r) => r.checked).map((r) => r.value)).toEqual(['1']);
  });
});

describe('home renderizada', () => {
  const markup = async () => renderToStaticMarkup(await Home());
  const home = async () => comoONavegadorLe(await markup());

  it('o navegador monta a mesma arvore que o React escreveu', async () => {
    confereArvore(await markup());
  });

  it('nenhum id repetido', async () => {
    const ids = [...(await home()).querySelectorAll('[id]')].map((el) => el.id);
    const repetidos = ids.filter((id, i) => ids.indexOf(id) !== i);

    expect(ids.length).toBeGreaterThan(0);
    expect(repetidos).toEqual([]);
  });

  it('os dois guias, da ficha e da loja, tem cada um o seu titulo', async () => {
    const pagina = await home();
    const guias = [...pagina.querySelectorAll('dialog.guia')];
    const titulos = guias.map((g) => g.getAttribute('aria-labelledby'));

    expect(guias).toHaveLength(2);
    expect(new Set(titulos).size).toBe(2);
    for (const [i, guia] of guias.entries()) {
      expect(guia.querySelector('h2')?.id).toBe(titulos[i]);
    }
  });

  // #286: a intro acende `.nitida` por cima de uma copia borrada, montada no
  // cliente. No HTML, cada linha tem a camada e o texto vem uma vez so.
  it('cada linha do manifesto tem a camada nitida, e o texto vem uma vez so', async () => {
    const linhas = [...(await home()).querySelectorAll('#manifesto .l')];

    expect(linhas).toHaveLength(7);
    for (const linha of linhas) {
      expect([...linha.children].map((filho) => filho.className)).toEqual(['nitida']);
    }
    // O logo do fim sai do servidor com medida, como o do hero (#344): sem
    // ela, a linha mudava de tamanho quando a imagem chegava.
    const logo = linhas.at(-1)?.querySelector('.nitida > img');
    expect(logo?.getAttribute('width')).toBe('1000');
    expect(logo?.getAttribute('height')).toBe('624');
    expect(logo?.getAttribute('alt')).toBe('');
    expect(linhas.at(-1)?.textContent).toBe('Passem a respeitar');
  });

  // #322: o JSON-LD sai no HTML do servidor, com o preco do catalogo e sem data.
  it('traz o JSON-LD com o selo, o site e a camiseta do catalogo', async () => {
    const blocos = (await home()).querySelectorAll('script[type="application/ld+json"]');
    expect(blocos).toHaveLength(1);
    const grafo = JSON.parse(blocos[0]?.textContent ?? '{}')['@graph'];
    expect(grafo.map((n: { '@type': string }) => n['@type'])).toEqual([
      'Organization',
      'WebSite',
      'MusicGroup',
      'MusicGroup',
      'MusicAlbum',
      'MusicRelease',
      'Product',
    ]);
    expect(grafo.at(-1)).toMatchObject({ name: 'Camiseta CBAC', offers: { price: '120.00' } });
    expect(blocos[0]?.textContent).not.toMatch(/date|year|rating|review/i);
  });

  // #275: os perfis saem prontos do servidor, sem depender do script legado.
  it('os tres perfis do Instagram vem no HTML do servidor, com rel="me"', async () => {
    const pagina = await home();
    const perfis = {
      igSantxx: ['https://instagram.com/ogsantxx', 'Santxx · @ogsantxx'],
      igChefe: ['https://instagram.com/ch3fe3k', 'Ch3fe · @ch3fe3k'],
      igLabel: ['https://instagram.com/whynotvisuals_', 'Whynot Visuals'],
    };
    for (const [id, [href, texto]] of Object.entries(perfis)) {
      const a = pagina.querySelector(`footer.assina #${id}`);
      expect(a?.getAttribute('href'), id).toBe(href);
      expect(a?.textContent, id).toBe(texto);
      expect(a?.getAttribute('rel')?.split(' '), id).toEqual(['me', 'noopener']);
    }
    // E o grafo aponta os mesmos perfis.
    const json = pagina.querySelector('script[type="application/ld+json"]')?.textContent ?? '';
    for (const [href] of Object.values(perfis)) expect(json).toContain(href);
  });

  // #386: o texto aprovado pelo dono, no HTML do servidor, entre a merch e o
  // rodape. E o genero do grafo so existe porque esse texto diz trap.
  it('a secao "quem sao" sai do servidor com o texto aprovado, antes do rodape', async () => {
    const pagina = await home();
    const secao = pagina.querySelector('main > #quem-sao');
    expect(secao?.querySelector('h2')?.textContent).toBe('Quem são Santxx e Ch3fe');
    expect(secao?.querySelector('p')?.textContent).toBe(
      'Santxx e Ch3fe são dois nomes do trap de São Paulo. Passem a Respeitar é o EP que os dois assinam juntos, pela Whynot Visuals.'
    );
    expect(secao?.previousElementSibling?.id).toBe('merch');
    expect(secao?.nextElementSibling?.matches('footer.assina')).toBe(true);

    const json = pagina.querySelector('script[type="application/ld+json"]')?.textContent ?? '';
    const grafo = JSON.parse(json)['@graph'] as { '@type': string; genre?: string[] }[];
    const artistas = grafo.filter((n) => n['@type'] === 'MusicGroup');
    expect(artistas).toHaveLength(2);
    for (const a of artistas) expect(a.genre).toEqual(['Trap', 'Rap']);
    expect(secao?.textContent).toMatch(/\btrap\b/i);
  });

  // #280: era um <div> clicavel, fora do Tab e sem papel de controle.
  it('o indicador "tocando" e um botao que nasce apagado, com o atalho exposto', async () => {
    const pill = (await home()).querySelector('#tocando');

    expect(pill?.localName).toBe('button');
    expect(pill?.getAttribute('type')).toBe('button');
    expect(pill?.getAttribute('aria-keyshortcuts')).toBe('N');
    // Apagado e transparente: fora do Tab e do leitor de tela ate o som ligar.
    expect(pill?.getAttribute('tabindex')).toBe('-1');
    expect(pill?.getAttribute('aria-hidden')).toBe('true');
    // O nome comeca pelo beat, que o script escreve, e diz o que o botao faz.
    expect(pill?.querySelector('#tocandoNome')).not.toBeNull();
    expect(pill?.querySelector('.sr')?.textContent).toBe(', pular para o próximo beat');
  });
});
