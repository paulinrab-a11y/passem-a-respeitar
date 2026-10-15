/**
 * JSON-LD da home (#322): um `@graph` so, com `@id` estaveis.
 *
 * Os `@id` sao ancoras (`<base>/#organizacao`) e nao mudam: a #275 acrescenta
 * Santxx, Ch3fe e o EP neste mesmo grafo, ligando por `@id`, sem mexer nos
 * nos de hoje.
 *
 * Regras que nao se negociam:
 *   - nenhuma data. A data de lancamento esta em sigilo ate o pre-save (#269),
 *     e por isso nao ha `datePublished`, `releaseDate` nem nada parecido;
 *   - nenhuma avaliacao ou nota inventada;
 *   - `sameAs` so com perfil que existe (hoje, o Instagram do selo);
 *   - preco e nome vem do catalogo, o mesmo que a ficha mostra e o checkout
 *     cobra. Sem catalogo, o Product some em vez de sair com numero velho.
 */

export type CamisetaNoGrafo = {
  slug: string;
  nome: string;
  descricao: string | null;
  /** Preco de cada tamanho, em centavos. */
  precosCentavos: number[];
};

type Entrada = {
  base: URL;
  nomeDoSite: string;
  descricaoDoSite: string;
  instagramDoSelo: string;
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
  const oferta =
    menor === maior
      ? {
          '@type': 'Offer',
          url: pagina,
          priceCurrency: 'BRL',
          price: emReais(menor),
          availability: disponibilidade,
        }
      : {
          '@type': 'AggregateOffer',
          url: pagina,
          priceCurrency: 'BRL',
          lowPrice: emReais(menor),
          highPrice: emReais(maior),
          offerCount: camiseta.precosCentavos.length,
          availability: disponibilidade,
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

export function grafoDoSite(e: Entrada) {
  const organizacao = idNoSite(e.base, 'organizacao');
  const nos: Record<string, unknown>[] = [
    {
      '@type': 'Organization',
      '@id': organizacao,
      name: 'Whynot Visuals',
      url: e.base.href,
      sameAs: [e.instagramDoSelo],
    },
    {
      '@type': 'WebSite',
      '@id': idNoSite(e.base, 'site'),
      name: e.nomeDoSite,
      description: e.descricaoDoSite,
      url: e.base.href,
      inLanguage: 'pt-BR',
      publisher: { '@id': organizacao },
    },
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
