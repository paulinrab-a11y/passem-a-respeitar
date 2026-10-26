/**
 * JSON-LD da home (#322): um `@graph` so, com `@id` estaveis.
 *
 * Os `@id` sao ancoras (`<base>/#organizacao`) e nao mudam. A #275 pos
 * Santxx, Ch3fe e o EP neste mesmo grafo, ligados por `@id`: os artistas sao
 * `MusicGroup` (o schema.org usa o mesmo tipo para artista solo), o EP e um
 * `MusicAlbum` do tipo EPRelease, e o lancamento (`MusicRelease`) aponta a
 * Whynot Visuals como `recordLabel`, que e onde o schema.org poe o selo.
 *
 * Regras que nao se negociam:
 *   - uma data so: a do lancamento, de `lib/ep.ts`, como `datePublished` do
 *     EP e do lancamento (as duas sao CreativeWork). Ela ficou em sigilo ate o
 *     pre-save (#269) e e publica desde 26/10/2026, quando ele saiu, e a home
 *     mostra o mesmo dia acima do botao. `releaseDate` e do Product no
 *     schema.org, nao de MusicAlbum nem de MusicRelease, entao nao entra;
 *   - o link do pre-save fica fora: nao e onde se ouve o EP (ListenAction) nem
 *     uma oferta (Offer), e o schema.org nao tem propriedade para ele;
 *   - nenhuma avaliacao ou nota inventada;
 *   - `sameAs` so com perfil que existe (hoje, o Instagram de cada um).
 *     Spotify e YouTube entram quando existirem, nao antes;
 *   - nada de faixa, descricao ou biografia que a pagina nao mostre.
 *   - preco e nome vem do catalogo, o mesmo que a ficha mostra e o checkout
 *     cobra. Sem catalogo, o Product some em vez de sair com numero velho.
 */

import { DATA_DE_LANCAMENTO, EP_E_O_LANCAMENTO, NOME_DO_LANCAMENTO } from './ep';
import { ARREPENDIMENTO_DIAS } from './loja/termos';

export type CamisetaNoGrafo = {
  slug: string;
  nome: string;
  descricao: string | null;
  /** Preco de cada tamanho, em centavos. */
  precosCentavos: number[];
};

type ArtistaNoGrafo = {
  /** Ancora do `@id` (`<base>/#<ancora>`). Estavel: outros nos apontam para ela. */
  ancora: string;
  nome: string;
  /** Perfis que existem de verdade. */
  perfis: string[];
  /**
   * Generos musicais (#386). So entram se o texto visivel da pagina disser o
   * mesmo: quem decide e o chamador, que confere o paragrafo "quem sao".
   */
  generos?: string[];
};

type Entrada = {
  base: URL;
  nomeDoSite: string;
  descricaoDoSite: string;
  instagramDoSelo: string;
  artistas: ArtistaNoGrafo[];
  nomeDoEp: string;
  camiseta: CamisetaNoGrafo | null;
  fotosDaCamiseta: string[];
};

const emReais = (centavos: number) => (centavos / 100).toFixed(2);

function idNoSite(base: URL, ancora: string): string {
  return new URL(`/#${ancora}`, base).href;
}

function produto(e: Entrada, camiseta: CamisetaNoGrafo) {
  const menor = Math.min(...camiseta.precosCentavos);
  const maior = Math.max(...camiseta.precosCentavos);
  const pagina = new URL('/#merch', e.base).href;
  // Feita sob encomenda (a ficha diz isso): MadeToOrder, e nao InStock. O
  // estoque nao e lido pelo papel publico, e prometer pronta-entrega seria
  // dizer ao Google o que a pagina nao diz.
  const disponibilidade = 'https://schema.org/MadeToOrder';
  // Nova, e com a devolucao que o /termos promete: 7 dias do recebimento,
  // frete de volta pago pela loja e o valor todo de volta (CDC art. 49).
  const condicoes = {
    itemCondition: 'https://schema.org/NewCondition',
    hasMerchantReturnPolicy: {
      '@type': 'MerchantReturnPolicy',
      applicableCountry: 'BR',
      returnPolicyCategory: 'https://schema.org/MerchantReturnFiniteReturnWindow',
      merchantReturnDays: ARREPENDIMENTO_DIAS,
      returnMethod: 'https://schema.org/ReturnByMail',
      returnFees: 'https://schema.org/FreeReturn',
      refundType: 'https://schema.org/FullRefund',
      merchantReturnLink: new URL('/termos#arrependimento', e.base).href,
    },
  };
  const oferta =
    menor === maior
      ? {
          '@type': 'Offer',
          url: pagina,
          priceCurrency: 'BRL',
          price: emReais(menor),
          availability: disponibilidade,
          ...condicoes,
        }
      : {
          '@type': 'AggregateOffer',
          url: pagina,
          priceCurrency: 'BRL',
          lowPrice: emReais(menor),
          highPrice: emReais(maior),
          offerCount: camiseta.precosCentavos.length,
          availability: disponibilidade,
          ...condicoes,
        };

  return {
    '@type': 'Product',
    '@id': idNoSite(e.base, 'camiseta'),
    name: camiseta.nome,
    ...(camiseta.descricao ? { description: camiseta.descricao } : {}),
    sku: camiseta.slug,
    // A camiseta e da CBAC, nao uma colab com o EP (decisao de 29/09).
    brand: { '@type': 'Brand', name: 'CBAC' },
    image: e.fotosDaCamiseta.map((f) => new URL(f, e.base).href),
    offers: oferta,
  };
}

/**
 * Os artistas, o EP e o lancamento pelo selo (#275), com o dia do lancamento
 * de `lib/ep.ts` e nenhuma outra data (nem `copyrightYear`).
 *
 * A data vai em quem sai nela (#406): enquanto o lancamento da vez e o single,
 * ela fica num `MusicRecording` do single, ligado ao EP, e o EP fica sem data
 * — a do EP ainda nao foi anunciada. Quando lib/ep.ts virar o EP, a data passa
 * para o EP e o no do single some.
 */
function musica(e: Entrada, organizacao: string) {
  const ep = idNoSite(e.base, 'ep');
  const artistas = e.artistas.map((a) => ({
    '@type': 'MusicGroup',
    '@id': idNoSite(e.base, a.ancora),
    name: a.nome,
    ...(a.generos && a.generos.length > 0 ? { genre: a.generos } : {}),
    ...(a.perfis.length > 0 ? { sameAs: a.perfis } : {}),
  }));
  const autoria = artistas.map((a) => ({ '@id': a['@id'] }));

  return [
    ...artistas,
    {
      '@type': 'MusicAlbum',
      '@id': ep,
      name: e.nomeDoEp,
      url: e.base.href,
      albumReleaseType: 'https://schema.org/EPRelease',
      ...(EP_E_O_LANCAMENTO ? { datePublished: DATA_DE_LANCAMENTO } : {}),
      byArtist: autoria,
      albumRelease: { '@id': idNoSite(e.base, 'ep-lancamento') },
    },
    {
      '@type': 'MusicRelease',
      '@id': idNoSite(e.base, 'ep-lancamento'),
      name: e.nomeDoEp,
      releaseOf: { '@id': ep },
      ...(EP_E_O_LANCAMENTO ? { datePublished: DATA_DE_LANCAMENTO } : {}),
      byArtist: autoria,
      recordLabel: { '@id': organizacao },
    },
    ...(EP_E_O_LANCAMENTO
      ? []
      : [
          {
            '@type': 'MusicRecording',
            '@id': idNoSite(e.base, 'single'),
            name: NOME_DO_LANCAMENTO,
            byArtist: autoria,
            inAlbum: { '@id': ep },
            datePublished: DATA_DE_LANCAMENTO,
          },
        ]),
  ];
}

export function grafoDoSite(e: Entrada) {
  const organizacao = idNoSite(e.base, 'organizacao');
  const nos: Record<string, unknown>[] = [
    {
      '@type': 'Organization',
      '@id': organizacao,
      name: 'Whynot Visuals',
      // Sem `url`: este site e do EP, nao do selo. O perfil e o `sameAs`.
      sameAs: [e.instagramDoSelo],
    },
    {
      '@type': 'WebSite',
      '@id': idNoSite(e.base, 'site'),
      name: e.nomeDoSite,
      alternateName: 'Passem a Respeitar',
      description: e.descricaoDoSite,
      url: e.base.href,
      inLanguage: 'pt-BR',
      publisher: { '@id': organizacao },
      about: { '@id': idNoSite(e.base, 'ep') },
    },
    ...musica(e, organizacao),
  ];

  if (e.camiseta && e.camiseta.precosCentavos.length > 0) nos.push(produto(e, e.camiseta));

  return { '@context': 'https://schema.org', '@graph': nos };
}

/**
 * JSON para dentro de `<script>`, com todo `<` escapado como \u003c: um nome de
 * produto com `</script>` fecharia a tag e o resto viraria HTML. O JSON continua o mesmo
 * para quem le.
 */
export function serializaJsonLd(dado: unknown): string {
  return JSON.stringify(dado).replace(/</g, '\\u003c');
}
