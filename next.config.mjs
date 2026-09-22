/**
 * Headers que nao dependem de nonce ficam aqui, aplicados a todas as rotas.
 * A Content-Security-Policy e montada por request no middleware.ts, porque
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

export default nextConfig;
