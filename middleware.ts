import { createServerClient } from '@supabase/ssr';
import { type NextRequest, NextResponse } from 'next/server';
import {
  destinoSeguro,
  ENTRAR,
  ehPagamento,
  ehRotaDeAuth,
  exigeSessao,
  precisaDeSessao,
} from '@/lib/rotas';
import { COOKIE_LEMBRAR, opcoesDeSessao } from '@/lib/supabase/cookies';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '@/lib/supabase/env';

// A Issue #14 trouxe imagens, modelo 3D, textura 360 e beats para public/,
// servidos pela propria origem, e o clipe saiu do Drive (#58, #75). O unico
// host externo que sobrou e o do Storage, e so em img-src, logo abaixo.
//
// Quando o clipe subir no YouTube, frame-src volta como
// 'https://www.youtube-nocookie.com' — e so isso.
const FRAME_SRC = "'none'";

// A foto de perfil e servida por URL assinada do Storage do Supabase (#26), que
// mora em outro host. Este e o unico host externo da politica, e so para
// imagem — nao para script, nem para frame, nem para connect.
//
// Derivado da variavel de ambiente, nao escrito na mao: trocar de projeto nao
// pode deixar a CSP apontando para o projeto antigo em silencio.
const SUPABASE_HOST = new URL(SUPABASE_URL).origin;

/**
 * Hosts do Mercado Pago, so na tela de pagamento (Issue #108).
 *
 * Escritos um a um, e a lista saiu de MEDICAO, nao de tutorial: montei o
 * Payment Brick com a politica de antes e li as violacoes que o navegador
 * reportou. Foram estas duas, e mais nada:
 *
 *   api.mercadopago.com   /v1/payment_methods/search e /v1/devices/widgets
 *   http2.mlstatic.com    os textos em pt do Brick (i18n/pt/payment/index.json)
 *
 * `script-src` nao precisou de nada, e vale registrar por que: com
 * `strict-dynamic`, host em script-src e IGNORADO. Quem confere confianca e o
 * nonce, e o script do SDK e criado por codigo que ja veio com nonce — entao
 * herda a confianca. Listar `sdk.mercadopago.com` ali seria linha morta.
 */
const MP_CONEXAO = [
  'https://api.mercadopago.com',
  // Os campos seguros — o iframe que guarda numero e CVV. Sem este host os
  // tres iframes sensiveis nascem com altura zero e o cartao nao existe.
  'https://api-static.mercadopago.com',
  'https://secure-fields.mercadopago.com',
  'https://http2.mlstatic.com',
];

/**
 * Antifraude do Mercado Pago (Issue #109) — so na tela de pagamento.
 *
 * Estes tres recursos ficaram BLOQUEADOS de proposito na #108: sao telemetria
 * e fingerprint de navegador (o `armor` carrega lista de plugins, versao,
 * referer). O Brick monta e funciona sem eles, mas o SDK avisa
 * `DeviceProfile could not be loaded`, e o device profile alimenta o score
 * antifraude — cartao pode ser recusado mais.
 *
 * Decisao do dono em 25/09/2026: liberar, e dizer isso na politica de
 * privacidade (/privacidade). E tratamento de dado pessoal; nao entra em
 * silencio. Continua restrito a esta rota: a home nao precisa de fingerprint.
 */
const MP_ANTIFRAUDE_CONEXAO = [
  // telemetria (/tracks) e device profile (/jms/lgz/background/etid)
  'https://api.mercadolibre.com',
  'https://www.mercadolibre.com',
];
const MP_ANTIFRAUDE_IMG = [
  // o pixel `armor` do device profile — medido nos DOIS dominios, .com e
  // .com.br disfarcado de mercadolivre. Sem um deles o SDK segue avisando.
  'https://www.mercadolibre.com',
  'https://www.mercadolivre.com',
];

/** Iframes do Brick. E dentro deles que o numero do cartao vive — nunca no nosso DOM. */
const MP_FRAME = [
  // Onde o numero do cartao e o CVV de fato moram.
  'https://secure-fields.mercadopago.com',
  'https://www.mercadopago.com',
];

function montaCsp(nonce: string, dev: boolean, pagamento: boolean) {
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
    [
      'img-src',
      "'self'",
      'data:',
      'blob:',
      SUPABASE_HOST,
      ...(pagamento ? MP_ANTIFRAUDE_IMG : []),
    ].join(' '),
    "media-src 'self'",
    // Os hosts externos novos valem SO na tela de pagamento. Na home e no
    // resto da conta a politica continua sendo exatamente a de antes.
    ['connect-src', "'self'", ...(pagamento ? [...MP_CONEXAO, ...MP_ANTIFRAUDE_CONEXAO] : [])].join(
      ' '
    ),
    ['frame-src', ...(pagamento ? MP_FRAME : [FRAME_SRC])].join(' '),
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

        // A escolha de "manter conectado" tem que ser relida aqui. Sem isso a
        // primeira renovacao de token gravaria o cookie com a validade cheia
        // do Supabase, e quem desmarcou a caixa continuaria logado depois de
        // fechar o navegador — justamente o contrario do que pediu.
        const lembrar = request.cookies.get(COOKIE_LEMBRAR)?.value === '1';

        for (const { name, value, options } of lista) {
          response.cookies.set(name, value, opcoesDeSessao(options, lembrar));
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

  // A tela de pagamento e a unica que carrega o Payment Brick, e a unica que
  // abre host externo. Conferir pelo caminho, e nao por um booleano global,
  // mantem a politica apertada em todo o resto do site.
  const csp = montaCsp(nonce, dev, ehPagamento(request.nextUrl.pathname));

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
