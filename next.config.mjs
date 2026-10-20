import { fileURLToPath } from 'node:url';
import { withSentryConfig } from '@sentry/nextjs/config';

/**
 * Headers que nao dependem de nonce ficam aqui, aplicados a todas as rotas.
 * A Content-Security-Policy e montada por request no proxy.ts, porque
 * precisa de um nonce novo a cada resposta.
 */
const securityHeaders = [
  {
    // 1 ano, como pede a Issue #16. `preload` fica de fora de proposito: so
    // deve entrar depois que o dominio final existir (#54) e estiver estavel,
    // porque sair da lista de preload depois e lento e doloroso.
    key: 'Strict-Transport-Security',
    value: 'max-age=31536000; includeSubDomains',
  },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    // Nega tudo que o site nao usa. Se o checkout do Mercado Pago (#44) pedir
    // a Payment Request API, `payment` vira `(self)`.
    key: 'Permissions-Policy',
    value: [
      'accelerometer=()',
      'autoplay=(self)',
      'camera=()',
      'display-capture=()',
      'encrypted-media=()',
      'fullscreen=(self)',
      'geolocation=()',
      'gyroscope=()',
      'magnetometer=()',
      'microphone=()',
      'midi=()',
      'payment=()',
      'usb=()',
      'xr-spatial-tracking=()',
    ].join(', '),
  },
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
];

/**
 * Extensoes e pastas de public/ que o matcher do proxy.ts deixa de fora
 * (#312). A lista e repetida la porque o Next exige string literal no
 * matcher; app/cache-de-assets.test.ts confere que as duas batem.
 */
export const EXTENSOES_DE_ASSET = [
  'png',
  'svg',
  'webp',
  'jpg',
  'jpeg',
  'mp3',
  'mp4',
  'gltf',
  'bin',
  'ico',
];
const PASTAS_DE_ASSET = '(merch|beats|elementos|clipe|bandeira)';
const EXTENSOES = EXTENSOES_DE_ASSET.join('|');

export const ASSETS_FORA_DO_PROXY = [
  `/:pasta${PASTAS_DE_ASSET}/:caminho*`,
  `/:caminho((?!_next/).*\\.(?:${EXTENSOES}))`,
];

export const ASSETS_COM_CACHE = [
  `/:pasta${PASTAS_DE_ASSET}/:caminho*`,
  '/:arquivo([^/]+\\.(?:png|svg))',
];

export const CACHE_DE_ASSET = 'public, max-age=86400, stale-while-revalidate=604800';

export const CSP_DE_ASSET = [
  "default-src 'none'",
  "img-src 'self' data:",
  "media-src 'self'",
  // SVG e o 404 do Next usam estilo; script nenhum.
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // O Next anuncia a versao no header por padrao. Nao ajuda em nada e entrega
  // de graca qual versao atacar.
  poweredByHeader: false,
  turbopack: {
    rules: {
      // Tracing e debug do Sentry fora do bundle do navegador (#360). So no
      // codigo do SDK e so no navegador: o servidor continua com tracing. O
      // porque de ser um loader esta no proprio arquivo.
      '*.{js,mjs,cjs}': {
        condition: {
          all: [
            'browser',
            { path: /node_modules[\\/]@sentry(?:-internal)?[\\/]/ },
            { content: /__SENTRY_(?:TRACING|DEBUG)__/ },
          ],
        },
        loaders: [
          fileURLToPath(new URL('./lib/sentry/sem-tracing-no-navegador.cjs', import.meta.url)),
        ],
      },
    },
  },
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      // Os caminhos abaixo nao passam pelo proxy.ts (#312), entao nao ganham
      // a CSP com nonce. Para um arquivo de verdade ela nao faria diferenca,
      // mas um 404 HTML em /merch/qualquer-coisa sairia sem CSP nenhuma. Esta
      // nega script e qualquer origem externa.
      ...ASSETS_FORA_DO_PROXY.map((source) => ({
        source,
        headers: [{ key: 'Content-Security-Policy', value: CSP_DE_ASSET }],
      })),
      // Cache no navegador para o que vem de public/. Sem `immutable`: os
      // nomes nao tem hash e ja houve troca de arquivo mantendo o nome (o
      // modelo da camiseta, #217). Um dia de cache e uma semana servindo o
      // velho enquanto revalida. `/_next/` fica de fora de proposito: o Next
      // so poe o `immutable` dele quando ninguem pos Cache-Control antes.
      ...ASSETS_COM_CACHE.map((source) => ({
        source,
        headers: [{ key: 'Cache-Control', value: CACHE_DE_ASSET }],
      })),
    ];
  },
};

/**
 * Sentry no build (#8): source maps sobem so quando ha SENTRY_AUTH_TOKEN, org e
 * projeto — sem eles o plugin so avisa e o build segue. E o caso do CI e de
 * quem nao tem conta.
 *
 * `tunnelRoute`: o navegador manda o erro para o proprio site, que repassa.
 * Sem host novo na CSP (connect-src continua 'self') e sem bloqueador de
 * anuncio derrubando o envio.
 */
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: true,
  tunnelRoute: '/monitoramento',
  widenClientFileUpload: true,
  disableLogger: true,
  sourcemaps: { deleteSourcemapsAfterUpload: true },
});
