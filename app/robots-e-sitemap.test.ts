import { afterEach, describe, expect, it, vi } from 'vitest';
import robots, { FECHADOS, ROBOS_DE_IA } from './robots';
import sitemap from './sitemap';

afterEach(() => vi.unstubAllEnvs());

describe('robots.txt (#322)', () => {
  it('fecha so /api, /auth e o tunel do Sentry, e aponta o sitemap absoluto', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://www.cbacoccupation.com.br');
    expect(robots().sitemap).toBe('https://www.cbacoccupation.com.br/sitemap.xml');
    expect(FECHADOS).toEqual(['/api/', '/auth/', '/monitoramento']);
  });

  // Paginas noindex precisam ser rastreaveis: bloqueadas, o Google nunca le
  // o noindex delas.
  it('nao bloqueia conta, checkout nem login', () => {
    const regras = [robots().rules].flat();
    for (const regra of regras) {
      const fechados = [regra.disallow].flat().join(' ');
      expect(fechados).not.toMatch(/conta|checkout|entrar|criar-conta/);
      expect(regra.allow).toBe('/');
    }
  });

  it('libera os robos de IA de treino num grupo explicito (decisao do dono)', () => {
    const regras = [robots().rules].flat();
    const ia = regras.find((r) => Array.isArray(r.userAgent));
    expect(ia?.userAgent).toEqual(['GPTBot', 'ClaudeBot', 'Google-Extended']);
    expect(ia?.userAgent).toEqual(ROBOS_DE_IA);
    expect(ia?.disallow).toEqual(FECHADOS);
  });
});

describe('sitemap.xml (#322)', () => {
  it('lista so as paginas indexaveis, em URL absoluta e sem data inventada', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://www.cbacoccupation.com.br');
    expect(sitemap()).toEqual([
      { url: 'https://www.cbacoccupation.com.br/' },
      { url: 'https://www.cbacoccupation.com.br/privacidade' },
      // Indexavel e com link no rodape: a politica de devolucao conta como
      // sinal de confianca da loja.
      { url: 'https://www.cbacoccupation.com.br/termos' },
    ]);
  });

  it('no preview usa o endereco do deploy', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
    vi.stubEnv('VERCEL_URL', 'passem-git-x.vercel.app');
    expect(sitemap()[1]?.url).toBe('https://passem-git-x.vercel.app/privacidade');
  });
});
