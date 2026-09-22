import type { Metadata, Viewport } from 'next';
import { Anton, Pirata_One } from 'next/font/google';
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

export const metadata: Metadata = {
  title: 'PASSEM A RESPEITAR — Santxx x Ch3fe',
  description: 'EP Passem a Respeitar. Santxx x Ch3fe. WhyNot Records. 20.11.2026.',
  openGraph: {
    title: 'PASSEM A RESPEITAR',
    description: 'O respeito vem antes dos números. EP 20.11.2026.',
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
      <body>{children}</body>
    </html>
  );
}
