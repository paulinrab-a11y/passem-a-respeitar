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
 * Sem data de lancamento, mesmo publica desde o pre-save (#269): descricao e
 * card ficam em cache no Google e no WhatsApp por semanas, e "sai dia tal"
 * viraria mentira no dia seguinte. A data mora em lib/ep.ts e aparece na
 * home, no JSON-LD e no /llms.txt.
 */
export const NOME_DO_SITE = 'CBAC - Passem a Respeitar';
/**
 * A descricao do `<meta name="description">` e do WebSite no JSON-LD. Perto
 * dos 155 caracteres que o Google mostra, com os nomes dos artistas e da
 * camiseta, e sem data (ver acima).
 */
export const DESCRICAO_DO_SITE =
  'Passem a Respeitar, o EP de Santxx e Ch3fe pela Whynot Visuals. Acompanhe o lançamento e garanta a Camiseta CBAC, feita sob encomenda com entrega para todo o Brasil.';
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
