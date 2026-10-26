import { afterEach, describe, expect, it, vi } from 'vitest';
import { LANCAMENTO_POR_EXTENSO } from '@/lib/ep';
import { CONFIG } from './_home/config';
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

  // A data de lancamento e publica desde o pre-save (#269): a de lib/ep.ts,
  // com o link do pre-save, e nenhuma outra data.
  it('a data de lancamento de lib/ep.ts e o link do pre-save', async () => {
    const texto = await GET().text();
    expect(texto).toContain(`- Data: ${LANCAMENTO_POR_EXTENSO}, em todas as plataformas.`);
    expect(texto).toContain(`- [Pre-save](${CONFIG.links.preSave})`);
    expect(texto.replaceAll(LANCAMENTO_POR_EXTENSO, '')).not.toMatch(
      /\b(19|20)\d{2}\b|\b\d{1,2}[./]\d{1,2}\b|novembro|dezembro|outubro/i
    );
  });
});
