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

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // O Next anuncia a versao no header por padrao. Nao ajuda em nada e entrega
  // de graca qual versao atacar.
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
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
