import { type NextRequest, NextResponse } from 'next/server';

// A Issue #14 trouxe imagens, modelo 3D, textura 360 e beats para public/,
// servidos pela propria origem. Com o clipe saindo do Drive (#58, #75), nao
// sobrou nenhum host externo: a politica inteira virou 'self'.
//
// Quando o clipe subir no YouTube, frame-src volta como
// 'https://www.youtube-nocookie.com' — e so isso.
const FRAME_SRC = "'none'";

function montaCsp(nonce: string, dev: boolean) {
  const script = [
    "'self'",
    `'nonce-${nonce}'`,
    // strict-dynamic: o script com nonce pode carregar os chunks do Next.
    // Sem isso, cada chunk precisaria do proprio nonce.
    "'strict-dynamic'",
    // React Refresh e o HMR do webpack usam eval. So em desenvolvimento.
    dev ? "'unsafe-eval'" : '',
  ].filter(Boolean);

  return [
    "default-src 'self'",
    `script-src ${script.join(' ')}`,
    // unsafe-inline em style e inevitavel: o Next injeta <style> inline e o
    // script legado escreve style="" direto no elemento. A Issue #16 proibe
    // unsafe-inline em script-src, que e onde ele de fato e perigoso.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self'",
    "connect-src 'self'",
    `frame-src ${FRAME_SRC}`,
    "font-src 'self'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    'upgrade-insecure-requests',
  ].join('; ');
}

export function middleware(request: NextRequest) {
  const dev = process.env.NODE_ENV !== 'production';

  // Rede de seguranca para http. Na Vercel o 301 ja acontece na borda e o
  // request chega como https; isto cobre qualquer outro host.
  //
  // O teste de host local nao e detalhe: `next start` serve em http puro e
  // manda x-forwarded-proto: http, entao sem esta guarda um build de producao
  // rodado na maquina redireciona para https://localhost e nunca responde.
  const host = request.nextUrl.hostname;
  const hostLocal = host === 'localhost' || host === '127.0.0.1' || host === '[::1]';

  if (!hostLocal && request.headers.get('x-forwarded-proto') === 'http') {
    const url = request.nextUrl.clone();
    url.protocol = 'https:';
    return NextResponse.redirect(url, 301);
  }

  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const nonce = btoa(String.fromCharCode(...bytes));

  const csp = montaCsp(nonce, dev);

  // O Next le o nonce do header de CSP do request para carimbar os proprios
  // scripts inline de hidratacao. Por isso o header vai no request tambem,
  // nao so na resposta.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  matcher: [
    {
      // Arquivo estatico e imagem otimizada nao precisam de CSP com nonce e
      // pagariam o custo do middleware a toa.
      source: '/((?!_next/static|_next/image|favicon.ico).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
