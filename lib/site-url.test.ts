import { afterEach, describe, expect, it, vi } from 'vitest';
import { urlDeRetorno, urlDoSite } from './site-url';

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
