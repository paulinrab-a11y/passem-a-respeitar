import { describe, expect, it } from 'vitest';
import { grafoDoSite, serializaJsonLd } from './dados-estruturados';

const BASE = new URL('https://www.cbacoccupation.com.br');
const camiseta = {
  slug: 'camiseta-cbac',
  nome: 'Camiseta CBAC',
  descricao: 'Camiseta oversized.',
  precosCentavos: [12000, 12000],
};
const entrada = {
  base: BASE,
  nomeDoSite: 'CBAC - Passem a Respeitar',
  descricaoDoSite: 'EP Passem a Respeitar. Santxx x Ch3fe. Whynot Visuals.',
  instagramDoSelo: 'https://instagram.com/whynotvisuals_',
  camiseta,
  fotosDaCamiseta: ['/merch/camiseta-01.jpg'],
};

type Grafo = ReturnType<typeof grafoDoSite>;
const nos = (g: Grafo) => g['@graph'];
const doTipo = (g: Grafo, tipo: string) => nos(g).find((n) => n['@type'] === tipo);

describe('grafoDoSite (#322)', () => {
  it('Organization, WebSite e Product com @id estaveis e ligados', () => {
    const g = grafoDoSite(entrada);
    expect(g['@context']).toBe('https://schema.org');
    expect(nos(g).map((n) => n['@id'])).toEqual([
      'https://www.cbacoccupation.com.br/#organizacao',
      'https://www.cbacoccupation.com.br/#site',
      'https://www.cbacoccupation.com.br/#camiseta',
    ]);
    expect(doTipo(g, 'Organization')).toMatchObject({
      name: 'Whynot Visuals',
      sameAs: ['https://instagram.com/whynotvisuals_'],
    });
    expect(doTipo(g, 'WebSite')).toMatchObject({
      inLanguage: 'pt-BR',
      publisher: { '@id': 'https://www.cbacoccupation.com.br/#organizacao' },
    });
  });

  it('Product com o preco do catalogo, imagem absoluta e feita sob encomenda', () => {
    expect(doTipo(grafoDoSite(entrada), 'Product')).toMatchObject({
      name: 'Camiseta CBAC',
      sku: 'camiseta-cbac',
      brand: { '@type': 'Brand', name: 'CBAC' },
      image: ['https://www.cbacoccupation.com.br/merch/camiseta-01.jpg'],
      offers: {
        '@type': 'Offer',
        price: '120.00',
        priceCurrency: 'BRL',
        availability: 'https://schema.org/MadeToOrder',
      },
    });
  });

  it('precos diferentes por tamanho viram AggregateOffer', () => {
    const g = grafoDoSite({
      ...entrada,
      camiseta: { ...camiseta, precosCentavos: [12000, 13550] },
    });
    expect(doTipo(g, 'Product')?.offers).toMatchObject({
      '@type': 'AggregateOffer',
      lowPrice: '120.00',
      highPrice: '135.50',
      offerCount: 2,
    });
  });

  it('sem catalogo, sem Product: nada de preco velho', () => {
    expect(doTipo(grafoDoSite({ ...entrada, camiseta: null }), 'Product')).toBeUndefined();
    const vazia = { ...entrada, camiseta: { ...camiseta, precosCentavos: [] } };
    expect(doTipo(grafoDoSite(vazia), 'Product')).toBeUndefined();
  });

  // Sigilo da data (#269) e nada inventado.
  it('sem data e sem avaliacao', () => {
    const json = JSON.stringify(grafoDoSite(entrada));
    expect(json).not.toMatch(/date|release|rating|review/i);
    expect(json).not.toMatch(/\b20\d{2}\b/);
  });
});

describe('serializaJsonLd (#322)', () => {
  it('escapa < para nao fechar a tag e continua sendo o mesmo JSON', () => {
    const dado = { nome: '</script><script>alert(1)</script>' };
    const texto = serializaJsonLd(dado);
    expect(texto).not.toContain('<');
    expect(JSON.parse(texto)).toEqual(dado);
  });
});
