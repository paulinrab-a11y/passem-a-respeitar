import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Achados da auditoria de acessibilidade medida em producao (#376).
 *
 * Quem mede de verdade e o navegador (largura da barra, area de toque, nome
 * acessivel); estas sao as invariantes que seguram as correcoes no codigo,
 * para a proxima mudanca de CSS nao desfazer uma delas sem ninguem ver.
 */
const CSS = readFileSync('app/globals.css', 'utf8');
const HOME = readFileSync('app/page.tsx', 'utf8');
const SCRIPT = readFileSync('app/_home/legacy-site.js', 'utf8');
const PRIVACIDADE = readFileSync('app/privacidade/page.tsx', 'utf8');
const TERMOS = readFileSync('app/termos/page.tsx', 'utf8');

/** O corpo da regra que comeca exatamente com `seletor{`. */
function regra(seletor: string, de = 0): string {
  const ini = CSS.indexOf(`${seletor}{`, de);
  expect(ini, seletor).toBeGreaterThan(-1);
  return CSS.slice(ini + seletor.length + 1, CSS.indexOf('}', ini));
}

/** O bloco de uma @media, do `{` de abertura ao `}` que o fecha. */
function media(cabeca: string, de = 0): string {
  const ini = CSS.indexOf(`${cabeca}{`, de);
  expect(ini, cabeca).toBeGreaterThan(-1);
  let i = ini + cabeca.length + 1;
  for (let fundo = 1; fundo > 0 && i < CSS.length; i++) {
    if (CSS[i] === '{') fundo++;
    else if (CSS[i] === '}') fundo--;
  }
  return CSS.slice(ini, i);
}

describe('barra abaixo de 375 px (WCAG 1.4.10)', () => {
  it('a regra estreita vem depois do gap de 11 px do celular, e tira o clipe', () => {
    const celular = CSS.lastIndexOf('#bar .right{gap:11px;');
    const estreita = CSS.lastIndexOf('@media (max-width:374px){');
    expect(celular).toBeGreaterThan(-1);
    expect(estreita).toBeGreaterThan(celular);

    const bloco = media('@media (max-width:374px)', estreita);
    expect(bloco).toMatch(/#bar \.right\{gap:\d+px;/);
    expect(bloco).toContain('#bar .right .bar-clipe{display:none}');
  });

  it('a regra de 360 px que o gap de cima anulava saiu', () => {
    expect(CSS).not.toContain('#bar .right{gap:10px');
  });

  it('o clipe da barra tem a classe que a regra esconde', () => {
    expect(HOME).toMatch(/<a href="#clipe" className="bar-clipe">/);
  });
});

describe('texto pequeno', () => {
  it('nada de 10 ou 11 px no site', () => {
    expect(CSS).not.toMatch(/font-size:1[01]px/);
  });

  it.each([
    '.pedido-status',
    '.conta-selo',
    '.sessoes-selo',
    '.senha-forca span',
    '.pedido-total span',
    '.pedidos-pagina-atual',
    '.guia-tabela thead th',
    '.admin-filtro',
    '.admin-entrega-resumo',
    'footer.assina .assina-credito',
    '#loja .dica',
  ])('%s tem pelo menos 12 px', (seletor) => {
    const tamanho = Number(regra(seletor).match(/font-size:(\d+)px/)?.[1]);
    expect(tamanho).toBeGreaterThanOrEqual(12);
  });
});

describe('termos e privacidade, texto de leitura', () => {
  it('corpo do site, entrelinha aberta e ate 60 caracteres', () => {
    expect(regra('.leitura .detalhe-nota')).toBe(
      'font-size:var(--t-body, 16px);line-height:1.65;max-width:60ch'
    );
  });

  it.each([
    ['privacidade', PRIVACIDADE],
    ['termos', TERMOS],
  ])('/%s usa a leitura', (_nome, pagina) => {
    expect(pagina).toContain('<section className="auth-caixa conta-caixa leitura">');
  });

  it('cada link de politica diz de quem e (WCAG 2.4.4)', () => {
    expect(PRIVACIDADE).not.toContain('política de privacidade deles');
    for (const servico of ['do Mercado Pago', 'da Cloudflare', 'do Melhor Envio', 'do Google']) {
      expect(PRIVACIDADE).toContain(`política de privacidade ${servico}`);
    }
  });
});

describe('alvos de toque no celular', () => {
  const celular = media(
    '@media (max-width:767px)',
    CSS.indexOf('/* Alvos de toque no celular (#376).')
  );

  it('a area cresce por padding e a margem negativa devolve o lugar', () => {
    expect(celular).toContain('#bar button,#bar a{padding-block:13px;margin-block:-9px}');
    expect(celular).toContain('.tocando{padding-block:15px;bottom:1px}');
    expect(celular).toMatch(/\.guia-abrir\{padding-block:13px;margin-block:-1px -13px\}/);
    expect(celular).toContain('footer.assina a{padding-block:6px;margin-block:-6px}');
  });
});

describe('controles da home', () => {
  it('o Comprar da ficha e um botao: so abre a loja', () => {
    expect(HOME).toMatch(/<button type="button" className="btn cheio" id="comprar">/);
    expect(SCRIPT).not.toContain("$('#comprar').href");
  });

  it('o Comprar da loja continua link: e ele que leva ao checkout', () => {
    expect(HOME).toMatch(/<a className="btn cheio off" id="comprarLoja"/);
  });

  it('o "entrar" do convite tem nome proprio, que comeca pelo texto visivel', () => {
    expect(HOME).toMatch(
      /<button type="submit" aria-label="Entrar com o código do convite">\s*entrar\s*<\/button>/
    );
  });
});
