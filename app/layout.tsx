import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';
import type { Metadata, Viewport } from 'next';
import { Anton, Pirata_One } from 'next/font/google';
import { baseDoSite } from '@/lib/base-do-site';
import { cartaoDoLink, DESCRICAO_DO_SITE, NOME_DO_SITE } from '@/lib/cartao-do-link';
import BarraDeRota from './_ui/BarraDeRota';
import './globals.css';

// As duas fontes da identidade. Auto-hospedadas pelo next/font em vez de virem
// do Google Fonts por <link>: tira uma requisicao bloqueante do caminho critico
// e evita ter que liberar fonts.googleapis.com na CSP (Issue #16).
const anton = Anton({
  subsets: ['latin'],
  weight: '400',
  display: 'swap',
  variable: '--font-anton',
});

const pirata = Pirata_One({
  subsets: ['latin'],
  weight: '400',
  display: 'swap',
  variable: '--font-pirata',
});

// Open Graph completo (#215). `metadataBase` torna absolutos o `og:url` e o
// `og:image`: sem ela o Next poe o endereco do deploy, e no preview isso ate
// serve, mas em producao precisa ser o dominio. A imagem e o logo que ja esta
// em /public (1000x624, perto do 1,91:1 que os cards pedem); arte propria de
// 1200x630 e decisao do dono.
const BASE = baseDoSite(process.env.NEXT_PUBLIC_SITE_URL, process.env.VERCEL_URL);

export const metadata: Metadata = {
  metadataBase: BASE,
  // Nome do site decidido pelo dono em 06/10/2026 (#218): a marca na frente.
  title: NOME_DO_SITE,
  description: DESCRICAO_DO_SITE,
  // Canonical por rota (#322): `./` vira o caminho da pagina servida, absoluto
  // pela `metadataBase`, e sem a query.
  alternates: { canonical: './' },
  // Preview fora do indice (#322). A Vercel ja manda X-Robots-Tag nos
  // enderecos de preview; isto cobre um alias que nao mande. As paginas que
  // ja sao noindex declaram o delas e continuam assim.
  ...(process.env.VERCEL_ENV === 'preview' ? { robots: { index: false, follow: false } } : {}),
  // Imagem, locale e o `og:url` por rota moram em lib/cartao-do-link.ts.
  ...cartaoDoLink(NOME_DO_SITE),
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#000000',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR" className={`${anton.variable} ${pirata.variable}`}>
      <body>
        {/* Antes do conteudo: a barra e a primeira coisa que o leitor de tela
            encontra quando a pagina esta saindo (#50). */}
        <BarraDeRota />
        {children}
        {/* Vercel Analytics e Speed Insights (#8). Os scripts vem da propria
            origem (/_vercel/...) e sao inseridos por codigo que ja tem nonce,
            entao passam na CSP com strict-dynamic sem host novo. Sem cookie,
            sem identificador de pessoa — e a Vercel que agrega. */}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
