import { expect, test } from '@playwright/test';
import { visitante } from './apoio/visitante';

// Cada arquivo e um visitante, com o IP dele: ver apoio/visitante.ts.
test.use({ extraHTTPHeaders: visitante('nao-encontrada') });

/**
 * Pagina de nao encontrado (#173).
 *
 * O defeito que este teste segura nao aparecia na tela: a pagina padrao do
 * Next era gerada no build, sem nonce, e a CSP barrava todos os scripts dela.
 * Quem via era o console.
 */
test('nao encontrada: 404 em portugues, com caminho de volta e console limpo', async ({ page }) => {
  const erros: string[] = [];
  page.on('pageerror', (e) => erros.push(e.message));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    // O proprio 404 do documento aparece no console como recurso que falhou.
    // E o que se quer; o resto nao.
    if (/Failed to load resource.*404/.test(m.text())) return;
    // Analytics e Speed Insights so existem na Vercel. Fora dela o endereco
    // deles responde com esta mesma pagina, e o navegador recusa HTML no
    // lugar de script. E do ambiente de teste, nao da pagina.
    if (m.text().includes('/_vercel/')) return;
    erros.push(m.text());
  });

  const resposta = await page.goto('/um-endereco-que-nao-existe');

  expect(resposta?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'Página não encontrada' })).toBeVisible();
  await expect(page).toHaveTitle(/Página não encontrada/);
  expect(await page.content()).not.toContain('This page could not be found');

  await expect(page.getByRole('link', { name: 'Voltar ao início' })).toHaveAttribute('href', '/');
  await expect(page.getByRole('link', { name: 'Meus pedidos' })).toHaveAttribute(
    'href',
    '/conta/pedidos'
  );
  await expect(page.locator('meta[name="robots"]').first()).toHaveAttribute('content', /noindex/);

  // Tempo para os scripts da pagina subirem — ou serem barrados.
  await page.waitForLoadState('load');
  await page.waitForTimeout(1000);
  expect(erros).toEqual([]);
});

test('nao encontrada: os scripts da pagina rodam', async ({ page }) => {
  await page.goto('/um-endereco-que-nao-existe');

  // O React so pendura as props no elemento quando o JavaScript da pagina
  // rodou. Com os scripts barrados pela CSP, isto nunca acontecia.
  const voltar = page.getByRole('link', { name: 'Voltar ao início' });
  await expect
    .poll(() => voltar.evaluate((el) => Object.keys(el).some((k) => k.startsWith('__react'))))
    .toBe(true);
});

test('nao encontrada: o link de volta leva a home', async ({ page }) => {
  await page.goto('/um-endereco-que-nao-existe');
  await page.getByRole('link', { name: 'Voltar ao início' }).click();

  await page.waitForURL((url) => url.pathname === '/');
});
