import type { MetadataRoute } from 'next';
import { DESCRICAO_DO_SITE, NOME_DO_SITE } from '@/lib/cartao-do-link';

/**
 * Manifesto do site: nome e icone de quem adiciona a pagina a tela inicial
 * do celular. Preto, como o resto da identidade.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: NOME_DO_SITE,
    short_name: 'CBAC',
    description: DESCRICAO_DO_SITE,
    start_url: '/',
    display: 'standalone',
    background_color: '#000000',
    theme_color: '#000000',
    lang: 'pt-BR',
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
      { src: '/apple-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  };
}
