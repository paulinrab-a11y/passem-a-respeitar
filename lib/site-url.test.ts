import { afterEach, describe, expect, it, vi } from 'vitest';
import { origemDoPedido, urlDeRetorno, urlDoSite } from './site-url';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('urlDoSite', () => {
  it('prefere NEXT_PUBLIC_SITE_URL, sem barra no fim', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://passemarespeitar.com.br/');
    expect(urlDoSite(new Headers({ host: 'outro.host' }))).toBe('https://passemarespeitar.com.br');
  });

  // Preview da Vercel: o link tem que voltar para o proprio preview.
  it('sem a variavel, usa o host do request em https', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
    expect(urlDoSite(new Headers({ host: 'passem-a-respeitar-abc-paulin7.vercel.app' }))).toBe(
      'https://passem-a-respeitar-abc-paulin7.vercel.app'
    );
  });

  it('respeita x-forwarded-host e x-forwarded-proto', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
    const h = new Headers({
      host: 'interno',
      'x-forwarded-host': 'site.com',
      'x-forwarded-proto': 'https',
    });
    expect(urlDoSite(h)).toBe('https://site.com');
  });

  it('localhost fica em http', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
    expect(urlDoSite(new Headers({ host: 'localhost:3000' }))).toBe('http://localhost:3000');
  });

  it('sem cabecalho nenhum, localhost', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
    expect(urlDoSite(new Headers())).toBe('http://localhost:3000');
  });
});

describe('urlDeRetorno', () => {
  it('aponta para o callback com o destino embutido', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://site.com');
    expect(urlDeRetorno(new Headers(), '/redefinir-senha')).toBe(
      'https://site.com/auth/callback?next=%2Fredefinir-senha'
    );
  });
});

describe('origemDoPedido (#168)', () => {
  const DO_NEXT = 'http://localhost:3000';

  it('sem cabecalho de host, vale a origem que o Next calculou', () => {
    expect(origemDoPedido(new Headers(), DO_NEXT)).toBe(DO_NEXT);
  });

  // O caso que a suite de ponta a ponta achou: `next start` aberto por IP.
  it('o host do pedido vence a origem do Next', () => {
    const h = new Headers({ host: '127.0.0.1:3000', 'x-forwarded-proto': 'http' });

    expect(origemDoPedido(h, DO_NEXT)).toBe('http://127.0.0.1:3000');
  });

  it('atras de proxy, vale o host e o esquema que o proxy informa', () => {
    const h = new Headers({
      host: 'interno:8080',
      'x-forwarded-host': 'passemarespeitar.com.br',
      'x-forwarded-proto': 'https',
    });

    expect(origemDoPedido(h, DO_NEXT)).toBe('https://passemarespeitar.com.br');
  });

  it('cadeia de proxies: vale o primeiro valor de cada cabecalho', () => {
    const h = new Headers({
      'x-forwarded-host': 'site.com, interno',
      'x-forwarded-proto': 'https, http',
    });

    expect(origemDoPedido(h, DO_NEXT)).toBe('https://site.com');
  });

  it('sem esquema informado, herda o da origem do Next', () => {
    expect(origemDoPedido(new Headers({ host: 'site.com' }), 'https://qualquer.test')).toBe(
      'https://site.com'
    );
  });

  it('esquema que nao e http nem https e ignorado', () => {
    const h = new Headers({ host: 'site.com', 'x-forwarded-proto': 'javascript' });

    expect(origemDoPedido(h, 'https://qualquer.test')).toBe('https://site.com');
  });

  it('aceita IPv6 com porta', () => {
    const h = new Headers({ host: '[::1]:3000', 'x-forwarded-proto': 'http' });

    expect(origemDoPedido(h, DO_NEXT)).toBe('http://[::1]:3000');
  });

  it.each([
    'site.com/caminho',
    'usuario@site.com',
    'site.com@mau.test',
    'https://mau.test',
    'site.com\\mau.test',
    'site com',
    'site.com?x=1',
    'site.com#x',
    '-site.com',
    'site.com:porta',
    '',
  ])('host torto (%j) e ignorado: vale a origem do Next', (host) => {
    expect(origemDoPedido(new Headers({ host }), DO_NEXT)).toBe(DO_NEXT);
  });

  it('o resultado e sempre uma origem: sem caminho, sem barra no fim', () => {
    const origem = origemDoPedido(new Headers({ host: 'Site.COM' }), 'https://x.test');

    expect(origem).toBe('https://site.com');
    expect(new URL(origem).origin).toBe(origem);
  });
});
