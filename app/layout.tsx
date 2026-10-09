import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';
import type { Metadata, Viewport } from 'next';
import { Anton, Pirata_One } from 'next/font/google';
import { baseDoSite } from '@/lib/base-do-site';
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
// Sem data de lancamento (#269): ela fica em sigilo ate o pre-save, por
// decisao do dono. O concierge diz o mesmo; o card do link nao pode contar.
const DESCRICAO = 'O respeito vem antes dos números.';
const IMAGEM = { url: '/logo.png', width: 1000, height: 624, alt: 'Passem a Respeitar' };

export const metadata: Metadata = {
  metadataBase: BASE,
  // Nome do site decidido pelo dono em 06/10/2026 (#218): a marca na frente.
  title: 'CBAC - Passem a Respeitar',
  description: 'EP Passem a Respeitar. Santxx x Ch3fe. Whynot Visuals.',
  openGraph: {
    type: 'website',
    locale: 'pt_BR',
    siteName: 'CBAC - Passem a Respeitar',
    url: '/',
    title: 'CBAC - Passem a Respeitar',
    description: DESCRICAO,
    images: [IMAGEM],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'CBAC - Passem a Respeitar',
    description: DESCRICAO,
    images: [IMAGEM],
  },
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
