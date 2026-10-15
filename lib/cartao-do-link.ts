import type { Metadata } from 'next';

/**
 * O card do link (Open Graph e Twitter), num lugar so (#322).
 *
 * O Next nao mescla `openGraph` entre layout e pagina: a pagina que declara o
 * dela substitui o do layout inteiro. Sem esta funcao, /privacidade teria que
 * repetir imagem, locale e site_name, e a copia envelheceria sozinha.
 *
 * `url: './'` e de proposito: o Next resolve contra o caminho da rota que esta
 * sendo servida e depois contra `metadataBase`. Com `'/'` fixo, toda pagina se
 * declarava como a home para o WhatsApp e o Facebook.
 *
 * Sem data de lancamento (#269): ela fica em sigilo ate o pre-save.
 */
export const NOME_DO_SITE = 'CBAC - Passem a Respeitar';
/** A descricao do `<meta name="description">` e do WebSite no JSON-LD. */
export const DESCRICAO_DO_SITE = 'EP Passem a Respeitar. Santxx x Ch3fe. Whynot Visuals.';
const DESCRICAO_DO_CARTAO = 'O respeito vem antes dos números.';
const IMAGEM = { url: '/logo.png', width: 1000, height: 624, alt: 'Passem a Respeitar' };

export function cartaoDoLink(titulo: string): Pick<Metadata, 'openGraph' | 'twitter'> {
  return {
    openGraph: {
      type: 'website',
      locale: 'pt_BR',
      siteName: NOME_DO_SITE,
      url: './',
      title: titulo,
      description: DESCRICAO_DO_CARTAO,
      images: [IMAGEM],
    },
    twitter: {
      card: 'summary_large_image',
      title: titulo,
      description: DESCRICAO_DO_CARTAO,
      images: [IMAGEM],
    },
  };
}
