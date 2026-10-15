import type { MetadataRoute } from 'next';
import { baseDoSite } from '@/lib/base-do-site';

/**
 * sitemap.xml (#322): so as paginas que podem entrar no indice. Conta,
 * checkout, login e cadastro sao noindex e ficam de fora; listar uma URL
 * noindex no sitemap e mandar sinal trocado ao Google.
 *
 * Sem `lastModified`: nao ha data honesta para pagina dinamica, e inventar uma
 * faz o Google desconfiar do campo no site inteiro.
 */
export const PAGINAS_PUBLICAS = ['/', '/privacidade'];

export default function sitemap(): MetadataRoute.Sitemap {
  const base = baseDoSite(process.env.NEXT_PUBLIC_SITE_URL, process.env.VERCEL_URL);
  return PAGINAS_PUBLICAS.map((caminho) => ({ url: new URL(caminho, base).href }));
}
