import { tryToParsePath } from 'next/dist/lib/try-to-parse-path';
import { describe, expect, it } from 'vitest';
import nextConfig, {
  ASSETS_COM_CACHE,
  ASSETS_FORA_DO_PROXY,
  CACHE_DE_ASSET,
  CSP_DE_ASSET,
  EXTENSOES_DE_ASSET,
} from '../next.config.mjs';
import { config } from '../proxy';

// #312: os arquivos de public/ saem do proxy e ganham cache no navegador. O
// que se confere aqui e a fronteira — quais caminhos o proxy ainda pega e
// quais headers cada um recebe —, com o mesmo parser de caminho que o Next usa.

function regex(fonte: string) {
  const { regexStr, error } = tryToParsePath(fonte);
  if (error || !regexStr) throw new Error(`caminho invalido: ${fonte}`);
  return new RegExp(regexStr);
}

const matcher = regex(config.matcher[0].source);
const passaNoProxy = (caminho: string) => matcher.test(caminho);

type Regra = { source: string; headers: { key: string; value: string }[] };

async function cabecalhosDe(caminho: string) {
  const regras = (await nextConfig.headers?.()) as Regra[];
  const saida: Record<string, string> = {};
  for (const regra of regras) {
    if (!regex(regra.source).test(caminho)) continue;
    for (const { key, value } of regra.headers) saida[key.toLowerCase()] = value;
  }
  return saida;
}

const ASSETS = [
  '/merch/camiseta.bin',
  '/merch/camiseta.gltf',
  '/merch/camiseta-cor.webp',
  '/merch/camiseta-01.jpg',
  '/beats/rage.mp3',
  '/elementos/corrente.webp',
  '/brasao.png',
  '/brasao.svg',
  '/logo.png',
  '/favicon.ico',
];

const PAGINAS = [
  '/',
  '/privacidade',
  '/conta',
  '/conta/pedidos',
  '/entrar',
  '/checkout/pagamento',
  '/api/concierge',
  '/api/mercado-pago/webhook',
  '/monitoramento',
];

describe('matcher do proxy', () => {
  it.each(ASSETS)('deixa %s de fora', (caminho) => {
    expect(passaNoProxy(caminho)).toBe(false);
  });

  it.each(PAGINAS)('continua pegando %s', (caminho) => {
    expect(passaNoProxy(caminho)).toBe(true);
  });

  it('nao confunde pagina que so comeca parecida com uma pasta de asset', () => {
    expect(passaNoProxy('/merchandising')).toBe(true);
  });

  it('usa a mesma lista de extensoes que o next.config', () => {
    for (const ext of EXTENSOES_DE_ASSET) {
      expect(passaNoProxy(`/qualquer/arquivo.${ext}`)).toBe(false);
    }
    const doMatcher = /\(\?:([a-z0-9|]+)\)\$/.exec(config.matcher[0].source)?.[1]?.split('|');
    expect(doMatcher).toEqual(EXTENSOES_DE_ASSET);
  });
});

describe('headers dos assets', () => {
  it.each(ASSETS)('%s ganha cache no navegador, sem immutable', async (caminho) => {
    // favicon.ico nao existe em public/ (fica com a #42); o resto e cacheado.
    if (caminho === '/favicon.ico') return;
    const h = await cabecalhosDe(caminho);
    expect(h['cache-control']).toBe(CACHE_DE_ASSET);
    expect(h['cache-control']).not.toContain('immutable');
  });

  it.each(ASSETS)('%s mantem os headers de seguranca e ganha a CSP estatica', async (caminho) => {
    const h = await cabecalhosDe(caminho);
    expect(h['x-frame-options']).toBe('DENY');
    expect(h['x-content-type-options']).toBe('nosniff');
    expect(h['strict-transport-security']).toContain('max-age=31536000');
    expect(h['content-security-policy']).toBe(CSP_DE_ASSET);
  });

  it('a CSP estatica nao libera script nem origem externa', () => {
    expect(CSP_DE_ASSET).toContain("default-src 'none'");
    expect(CSP_DE_ASSET).not.toContain('script-src');
    expect(CSP_DE_ASSET).toContain("frame-ancestors 'none'");
    expect(CSP_DE_ASSET).not.toMatch(/https?:/);
  });

  it('todo caminho fora do proxy tem CSP estatica', () => {
    // Se um caminho sai do proxy sem entrar aqui, um 404 HTML nele sairia sem
    // CSP nenhuma.
    const fora = ASSETS_FORA_DO_PROXY.map(regex);
    for (const caminho of [...ASSETS, '/merch/nao-existe', '/beats/', '/a/b/c.jpeg']) {
      expect(fora.some((r) => r.test(caminho))).toBe(true);
    }
  });

  it.each(['/_next/static/chunks/main.js', '/_next/static/media/fonte.png'])(
    'nao mexe no cache de %s (o Next poe immutable)',
    async (caminho) => {
      const h = await cabecalhosDe(caminho);
      expect(h['cache-control']).toBeUndefined();
      expect(h['content-security-policy']).toBeUndefined();
    }
  );

  it.each(PAGINAS)('%s nao ganha cache nem a CSP estatica', async (caminho) => {
    const h = await cabecalhosDe(caminho);
    expect(h['cache-control']).toBeUndefined();
    // A CSP das paginas vem do proxy, com nonce.
    expect(h['content-security-policy']).toBeUndefined();
    expect(h['x-frame-options']).toBe('DENY');
  });

  it('cache so na raiz e nas pastas de asset, nunca em subpasta qualquer', () => {
    const comCache = ASSETS_COM_CACHE.map(regex);
    expect(comCache.some((r) => r.test('/conta/foto.png'))).toBe(false);
  });
});
