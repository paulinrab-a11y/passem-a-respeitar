import { describe, expect, it, vi } from 'vitest';
import { PROMPT_DO_CONCIERGE } from '@/lib/concierge/prompt';
import { LANCAMENTO } from '@/lib/lancamento';

// O layout carrega as fontes do Google no build; no teste isso vira classe.
vi.mock('next/font/google', () => ({
  Anton: () => ({ variable: 'anton' }),
  Pirata_One: () => ({ variable: 'pirata' }),
}));
vi.mock('@vercel/analytics/next', () => ({ Analytics: () => null }));
vi.mock('@vercel/speed-insights/next', () => ({ SpeedInsights: () => null }));

describe('metadata do layout (#215)', () => {
  it('tem base, url, imagem, site_name e locale para o Open Graph', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://www.cbacoccupation.com.br');
    vi.resetModules();
    const { metadata } = await import('./layout');

    expect(String(metadata.metadataBase)).toBe('https://www.cbacoccupation.com.br/');
    const og = metadata.openGraph as Record<string, unknown>;
    expect(og).toMatchObject({
      type: 'website',
      locale: 'pt_BR',
      siteName: 'CBAC - Passem a Respeitar',
      url: '/',
    });
    expect(og.images).toEqual([
      expect.objectContaining({ url: '/logo.png', width: 1000, height: 624 }),
    ]);
    const tw = metadata.twitter as Record<string, unknown>;
    expect(tw.card).toBe('summary_large_image');
    expect(tw.images).toEqual(og.images);
  });
});

// O card do link e o concierge aparecem na mesma visita (#269). Antes o card
// dizia 20.11.2026 e o concierge negava que houvesse data.
describe('a data no card do link', () => {
  it('description, og e twitter dizem a data que o concierge fala', async () => {
    const { metadata } = await import('./layout');
    const og = metadata.openGraph as Record<string, unknown>;
    const tw = metadata.twitter as Record<string, unknown>;

    expect(metadata.description).toContain(LANCAMENTO.curto);
    expect(og.description).toContain(LANCAMENTO.curto);
    expect(tw.description).toContain(LANCAMENTO.curto);
    expect(PROMPT_DO_CONCIERGE).toContain(LANCAMENTO.porExtenso);
  });
});
