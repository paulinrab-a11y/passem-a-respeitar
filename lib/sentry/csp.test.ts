import { afterEach, describe, expect, it, vi } from 'vitest';
import { cabecalhoDeRelatorio, diretivasDeRelatorio, urlDeRelatorio } from './csp';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('urlDeRelatorio', () => {
  it('a DSN vira o endpoint de seguranca do mesmo projeto', () => {
    vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', 'production');

    expect(urlDeRelatorio('https://abc123@o42.ingest.us.sentry.io/7')).toBe(
      'https://o42.ingest.us.sentry.io/api/7/security/?sentry_key=abc123&sentry_environment=production'
    );
  });

  // Preview e producao no mesmo projeto do Sentry: o rotulo e o que separa.
  it('leva o ambiente do deploy', () => {
    vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', 'preview');

    const url = new URL(urlDeRelatorio('https://abc@o1.ingest.sentry.io/1') ?? '');
    expect(url.searchParams.get('sentry_environment')).toBe('preview');
  });

  it('mantem o prefixo de caminho de um Sentry auto-hospedado', () => {
    vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', 'production');

    expect(urlDeRelatorio('https://abc@sentry.exemplo.test/sub/9')).toBe(
      'https://sentry.exemplo.test/sub/api/9/security/?sentry_key=abc&sentry_environment=production'
    );
  });

  // A chave secreta das DSN antigas nunca vai parar num cabecalho publico.
  it('descarta a parte secreta de DSN no formato antigo', () => {
    const url = urlDeRelatorio('https://publica:secreta@o1.ingest.sentry.io/1') ?? '';

    expect(url).not.toContain('secreta');
    expect(new URL(url).searchParams.get('sentry_key')).toBe('publica');
  });

  it.each([
    ['sem DSN', undefined],
    ['DSN vazia', ''],
    ['texto que nao e URL', 'nao-e-dsn'],
    ['sem chave', 'https://o1.ingest.sentry.io/1'],
    ['sem projeto', 'https://abc@o1.ingest.sentry.io/'],
    ['projeto que nao e numero', 'https://abc@o1.ingest.sentry.io/projeto'],
    ['protocolo estranho', 'javascript://abc@o1.ingest.sentry.io/1'],
  ])('%s nao gera URL', (_caso, dsn) => {
    expect(urlDeRelatorio(dsn)).toBeNull();
  });
});

describe('diretivas e cabecalho', () => {
  const url = 'https://o1.ingest.sentry.io/api/1/security/?sentry_key=abc';

  it('report-uri e report-to apontam para o mesmo lugar', () => {
    expect(diretivasDeRelatorio(url)).toEqual([`report-uri ${url}`, 'report-to csp-endpoint']);
    expect(cabecalhoDeRelatorio(url)).toBe(`csp-endpoint="${url}"`);
  });

  // Aspas ou ponto e virgula na URL quebrariam o cabecalho ou abririam uma
  // diretiva nova na CSP. A URL montada sai sempre codificada.
  it('a URL montada nao carrega caractere que quebre o cabecalho', () => {
    const montada = urlDeRelatorio('https://a%22b%3Bc@o1.ingest.sentry.io/1') ?? '';

    expect(montada).not.toMatch(/[";\s,]/);
  });
});
