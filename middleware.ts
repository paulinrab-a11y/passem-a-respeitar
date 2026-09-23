import { createServerClient } from '@supabase/ssr';
import { type NextRequest, NextResponse } from 'next/server';
import { destinoSeguro, ENTRAR, ehRotaDeAuth, exigeSessao, precisaDeSessao } from '@/lib/rotas';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '@/lib/supabase/env';

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

/**
 * Confere a sessao e, de quebra, renova o token.
 *
 * Devolve o usuario e a resposta que carrega os cookies novos. A resposta tem
 * que ser essa, e nao outra: o Supabase escreve o token renovado nela, e uma
 * resposta montada depois sairia sem os cookies — a pessoa seria deslogada em
 * silencio assim que o token antigo vencesse.
 */
async function leSessao(request: NextRequest, requestHeaders: Headers) {
  let response = NextResponse.next({ request: { headers: requestHeaders } });

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(lista) {
        for (const { name, value } of lista) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request: { headers: requestHeaders } });
        for (const { name, value, options } of lista) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // getUser, nao getSession: o token vai ao Supabase e a assinatura e
  // conferida la. getSession le o cookie e acredita nele, o que aqui seria o
  // mesmo que deixar o visitante dizer quem ele e.
  const { data } = await supabase.auth.getUser();
  return { usuario: data.user, response };
}

export async function middleware(request: NextRequest) {
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

  const { pathname } = request.nextUrl;

  if (!precisaDeSessao(pathname)) {
    const response = NextResponse.next({ request: { headers: requestHeaders } });
    response.headers.set('Content-Security-Policy', csp);
    return response;
  }

  const { usuario, response } = await leSessao(request, requestHeaders);

  // Sem sessao numa rota de conta: manda para o login guardando onde a pessoa
  // queria chegar, para o login devolver ela ali depois.
  if (exigeSessao(pathname) && !usuario) {
    const url = request.nextUrl.clone();
    url.pathname = ENTRAR;
    url.search = '';
    url.searchParams.set('next', `${pathname}${request.nextUrl.search}`);
    return comCsp(NextResponse.redirect(url), response, csp);
  }

  // Ja logado numa pagina de login ou cadastro: nao ha nada a fazer ali.
  if (ehRotaDeAuth(pathname) && usuario) {
    // `new URL` com base monta caminho e query de uma vez. O destino ja saiu
    // validado de destinoSeguro, entao a base so completa o host.
    const destino = destinoSeguro(request.nextUrl.searchParams.get('next'));
    return comCsp(NextResponse.redirect(new URL(destino, request.nextUrl.origin)), response, csp);
  }

  response.headers.set('Content-Security-Policy', csp);
  return response;
}

/**
 * Copia para a resposta de redirecionamento os cookies que o Supabase escreveu
 * na outra, e carimba a CSP.
 *
 * Sem essa copia o token renovado ficaria na resposta que foi descartada, e a
 * pessoa rodaria com o token velho ate ser deslogada sem motivo aparente.
 */
function comCsp(redirecionamento: NextResponse, origem: NextResponse, csp: string) {
  for (const cookie of origem.cookies.getAll()) {
    redirecionamento.cookies.set(cookie);
  }
  redirecionamento.headers.set('Content-Security-Policy', csp);
  return redirecionamento;
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
