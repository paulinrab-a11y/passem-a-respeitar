import { describe, expect, it } from 'vitest';
import { baseDoSite } from './base-do-site';

describe('baseDoSite (#215)', () => {
  it('usa o NEXT_PUBLIC_SITE_URL quando e URL http(s)', () => {
    expect(baseDoSite('https://www.cbacoccupation.com.br', 'x.vercel.app').href).toBe(
      'https://www.cbacoccupation.com.br/'
    );
    expect(baseDoSite(' https://www.cbacoccupation.com.br/ ', undefined).host).toBe(
      'www.cbacoccupation.com.br'
    );
  });

  it('cai no VERCEL_URL sem o endereco fixo', () => {
    expect(baseDoSite(undefined, 'passem-git-x-paulin7.vercel.app').href).toBe(
      'https://passem-git-x-paulin7.vercel.app/'
    );
    expect(baseDoSite('', 'passem-git-x-paulin7.vercel.app').host).toBe(
      'passem-git-x-paulin7.vercel.app'
    );
  });

  it('endereco torto cai na reserva', () => {
    expect(baseDoSite('www.cbacoccupation.com.br', 'x.vercel.app').host).toBe('x.vercel.app');
    expect(baseDoSite('ftp://cbacoccupation.com.br', 'x.vercel.app').host).toBe('x.vercel.app');
    expect(baseDoSite('nao e url', undefined).href).toBe('http://localhost:3000/');
  });

  it('sem nada, localhost', () => {
    expect(baseDoSite(undefined, undefined).href).toBe('http://localhost:3000/');
  });
});
