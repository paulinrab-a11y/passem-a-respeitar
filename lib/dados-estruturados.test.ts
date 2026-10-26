import { describe, expect, it } from 'vitest';
import { grafoDoSite, serializaJsonLd } from './dados-estruturados';
import { DATA_DE_LANCAMENTO, EP_E_O_LANCAMENTO, NOME_DO_LANCAMENTO } from './ep';
import { ARREPENDIMENTO_DIAS } from './loja/termos';

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
  artistas: [
    { ancora: 'santxx', nome: 'Santxx', perfis: ['https://instagram.com/ogsantxx'] },
    { ancora: 'ch3fe', nome: 'Ch3fe', perfis: ['https://instagram.com/ch3fe3k'] },
  ],
  nomeDoEp: 'Passem a Respeitar',
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
      'https://www.cbacoccupation.com.br/#santxx',
      'https://www.cbacoccupation.com.br/#ch3fe',
      'https://www.cbacoccupation.com.br/#ep',
      'https://www.cbacoccupation.com.br/#ep-lancamento',
      ...(EP_E_O_LANCAMENTO ? [] : ['https://www.cbacoccupation.com.br/#single']),
      'https://www.cbacoccupation.com.br/#camiseta',
    ]);
    expect(doTipo(g, 'Organization')).toMatchObject({
      name: 'Whynot Visuals',
      sameAs: ['https://instagram.com/whynotvisuals_'],
    });
    // Este site e do EP, nao do selo.
    expect(doTipo(g, 'Organization')).not.toHaveProperty('url');
    expect(doTipo(g, 'WebSite')).toMatchObject({ alternateName: 'Passem a Respeitar' });
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

  // A devolucao que o /termos promete, no formato do Google Merchant.
  it('oferta nova, com a politica de devolucao dos termos', () => {
    const oferta = doTipo(grafoDoSite(entrada), 'Product')?.offers;
    expect(oferta).toMatchObject({
      itemCondition: 'https://schema.org/NewCondition',
      hasMerchantReturnPolicy: {
        '@type': 'MerchantReturnPolicy',
        applicableCountry: 'BR',
        returnPolicyCategory: 'https://schema.org/MerchantReturnFiniteReturnWindow',
        merchantReturnDays: ARREPENDIMENTO_DIAS,
        returnFees: 'https://schema.org/FreeReturn',
        refundType: 'https://schema.org/FullRefund',
        merchantReturnLink: 'https://www.cbacoccupation.com.br/termos#arrependimento',
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

  // A data e publica desde o pre-save (#269), e so a de lib/ep.ts; nada inventado.
  it('so a data de lancamento de lib/ep.ts, e sem avaliacao', () => {
    const g = grafoDoSite(entrada);
    const json = JSON.stringify(g);
    // A data vai em quem sai nela (#406): no single enquanto ele for o
    // lancamento da vez, e o EP sem data; no EP quando lib/ep.ts virar o EP.
    if (EP_E_O_LANCAMENTO) {
      expect(doTipo(g, 'MusicAlbum')).toMatchObject({ datePublished: DATA_DE_LANCAMENTO });
      expect(doTipo(g, 'MusicRelease')).toMatchObject({ datePublished: DATA_DE_LANCAMENTO });
    } else {
      expect(doTipo(g, 'MusicRecording')).toMatchObject({
        name: NOME_DO_LANCAMENTO,
        datePublished: DATA_DE_LANCAMENTO,
        inAlbum: { '@id': 'https://www.cbacoccupation.com.br/#ep' },
      });
      expect(doTipo(g, 'MusicAlbum')).not.toHaveProperty('datePublished');
      expect(doTipo(g, 'MusicRelease')).not.toHaveProperty('datePublished');
    }
    // Nenhuma outra chave de data alem das `datePublished` de lib/ep.ts.
    // "Release" sozinho pode: e o nome do tipo (MusicRelease, EPRelease).
    expect(json.match(/"[a-zA-Z]*(?:date|year)[a-zA-Z]*"\s*:/gi)).toEqual(
      EP_E_O_LANCAMENTO ? ['"datePublished":', '"datePublished":'] : ['"datePublished":']
    );
    expect(json).not.toMatch(/releaseDate|rating|review/i);
    // Todo ano que aparece e o da data de lancamento, dentro dela.
    const semAData = json.replaceAll(`"${DATA_DE_LANCAMENTO}"`, '""');
    expect(semAData).not.toMatch(/\b(19|20)\d{2}\b/);
  });
});

describe('artistas e EP no grafo (#275)', () => {
  const g = grafoDoSite(entrada);
  const id = (ancora: string) => `${BASE.origin}/#${ancora}`;
  const porId = (ancora: string) => nos(g).find((n) => n['@id'] === id(ancora));

  it('Santxx e Ch3fe sao MusicGroup com o Instagram oficial', () => {
    expect(porId('santxx')).toEqual({
      '@type': 'MusicGroup',
      '@id': id('santxx'),
      name: 'Santxx',
      sameAs: ['https://instagram.com/ogsantxx'],
    });
    expect(porId('ch3fe')).toMatchObject({
      '@type': 'MusicGroup',
      name: 'Ch3fe',
      sameAs: ['https://instagram.com/ch3fe3k'],
    });
  });

  // #386: genero so quando o chamador manda (a pagina mostra o texto).
  it('genero entra no MusicGroup so quando vem na entrada', () => {
    const comGenero = grafoDoSite({
      ...entrada,
      artistas: entrada.artistas.map((a) => ({ ...a, generos: ['Trap', 'Rap'] })),
    });
    expect(nos(comGenero).find((n) => n['@id'] === id('santxx'))).toMatchObject({
      genre: ['Trap', 'Rap'],
    });
    expect(porId('santxx')).not.toHaveProperty('genre');
  });

  it('o EP e um MusicAlbum EPRelease dos dois, ligado por @id', () => {
    expect(porId('ep')).toMatchObject({
      '@type': 'MusicAlbum',
      name: 'Passem a Respeitar',
      albumReleaseType: 'https://schema.org/EPRelease',
      byArtist: [{ '@id': id('santxx') }, { '@id': id('ch3fe') }],
      albumRelease: { '@id': id('ep-lancamento') },
    });
  });

  it('o lancamento tem a Whynot Visuals como recordLabel', () => {
    expect(porId('ep-lancamento')).toMatchObject({
      '@type': 'MusicRelease',
      releaseOf: { '@id': id('ep') },
      byArtist: [{ '@id': id('santxx') }, { '@id': id('ch3fe') }],
      recordLabel: { '@id': id('organizacao') },
    });
    expect(doTipo(g, 'WebSite')).toMatchObject({ about: { '@id': id('ep') } });
  });

  it('todo @id citado existe no grafo', () => {
    const existentes = new Set(nos(g).map((n) => n['@id']));
    const citados = [...JSON.stringify(g).matchAll(/\{"@id":"([^"]+)"\}/g)].map((m) => m[1]);
    expect(citados.length).toBeGreaterThan(0);
    for (const citado of citados) expect(existentes, citado).toContain(citado);
  });

  it('sameAs so com perfil real, e sem a chave quando nao ha perfil', () => {
    const semPerfil = grafoDoSite({
      ...entrada,
      artistas: [{ ancora: 'santxx', nome: 'Santxx', perfis: [] }],
    });
    expect(doTipo(semPerfil, 'MusicGroup')).not.toHaveProperty('sameAs');
    for (const n of nos(g)) {
      for (const url of (n.sameAs as string[] | undefined) ?? []) {
        expect(url).toMatch(/^https:\/\/instagram\.com\/[a-z0-9_.]+$/);
      }
    }
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
