import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET } from './llms.txt/route';
import manifest from './manifest';

afterEach(() => vi.unstubAllEnvs());

describe('manifest', () => {
  it('nome do site, preto e com os icones que existem', () => {
    const m = manifest();
    expect(m.name).toBe('CBAC - Passem a Respeitar');
    expect(m.theme_color).toBe('#000000');
    expect(m.icons?.map((i) => i.src)).toEqual(['/icon.svg', '/apple-icon.png']);
  });
});

describe('/llms.txt', () => {
  it('texto puro com artistas, selo e paginas, em URL absoluta', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://www.cbacoccupation.com.br');
    const r = GET();
    expect(r.headers.get('content-type')).toContain('text/plain');
    const texto = await r.text();
    for (const trecho of [
      'Santxx',
      'Ch3fe',
      'Whynot Visuals',
      'https://www.cbacoccupation.com.br/termos',
      'https://www.cbacoccupation.com.br/privacidade',
    ]) {
      expect(texto).toContain(trecho);
    }
  });

  // Sigilo da data de lancamento (#269).
  it('sem data nem ano', async () => {
    const texto = await GET().text();
    expect(texto).not.toMatch(/\b(19|20)\d{2}\b/);
  });
});
