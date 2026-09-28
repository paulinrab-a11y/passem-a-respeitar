import { expect, test } from '@playwright/test';

/**
 * A home, no build de producao.
 *
 * Nao e teste de animacao: nenhum teste automatico pega regressao de
 * animacao, e quem confere isso e gente olhando. O que se pega aqui e o que
 * quebra em silencio — a politica de seguranca barrando um script do proprio
 * site, ou um erro de JavaScript que so existe fora do modo de
 * desenvolvimento.
 */
test('home: abre sem erro de script e sem violar a politica de seguranca', async ({ page }) => {
  const erros: string[] = [];
  const barrados: string[] = [];

  page.on('pageerror', (e) => erros.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && /Content Security Policy/i.test(m.text())) barrados.push(m.text());
  });

  const resposta = await page.goto('/');
  expect(resposta?.status()).toBe(200);
  await expect(page).toHaveTitle(/Passem a Respeitar/i);

  // Tempo para o script da home subir e pedir o que pede.
  await page.waitForLoadState('load');
  await page.waitForTimeout(1500);

  expect(barrados).toEqual([]);
  expect(erros).toEqual([]);
});

test('home: os cabecalhos de seguranca saem no build de producao', async ({ request }) => {
  const resposta = await request.get('/');
  const cabecalhos = resposta.headers();

  const csp = cabecalhos['content-security-policy'] ?? '';
  expect(csp).toContain("default-src 'self'");
  expect(csp).toMatch(/script-src [^;]*'nonce-/);
  // Os dois que a #16 proibe em script-src.
  const scriptSrc = /script-src ([^;]*)/.exec(csp)?.[1] ?? '';
  expect(scriptSrc).not.toContain("'unsafe-inline'");
  expect(scriptSrc).not.toContain("'unsafe-eval'");

  expect(cabecalhos['x-frame-options']).toBe('DENY');
  expect(cabecalhos['x-content-type-options']).toBe('nosniff');
  expect(cabecalhos['strict-transport-security']).toContain('max-age=31536000');
  expect(cabecalhos['x-powered-by']).toBeUndefined();
});
