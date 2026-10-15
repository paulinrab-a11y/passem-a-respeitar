import type { MetadataRoute } from 'next';
import { baseDoSite } from '@/lib/base-do-site';

/**
 * robots.txt (#322).
 *
 * Fecha so o que nao e pagina: `/api/` (webhook, cron, concierge), `/auth/`
 * (o retorno do login) e `/monitoramento` (o tunel do Sentry). Conta, checkout
 * e login NAO entram aqui de proposito: ja sao noindex no metadado, e bloquear
 * o rastreio impediria o Google de ler esse noindex. Uma URL bloqueada que
 * recebe link de fora pode ate aparecer no indice, sem conteudo.
 *
 * Robos de IA de treino liberados por decisao do dono (09/10/2026), para os
 * artistas aparecerem nas respostas. O grupo explicito diz isso por escrito, e
 * repete o `disallow` porque quem acha o proprio grupo ignora o do `*`.
 */
export const FECHADOS = ['/api/', '/auth/', '/monitoramento'];
export const ROBOS_DE_IA = ['GPTBot', 'ClaudeBot', 'Google-Extended'];

export default function robots(): MetadataRoute.Robots {
  const base = baseDoSite(process.env.NEXT_PUBLIC_SITE_URL, process.env.VERCEL_URL);
  return {
    rules: [
      { userAgent: '*', allow: '/', disallow: FECHADOS },
      { userAgent: ROBOS_DE_IA, allow: '/', disallow: FECHADOS },
    ],
    sitemap: new URL('/sitemap.xml', base).href,
  };
}
