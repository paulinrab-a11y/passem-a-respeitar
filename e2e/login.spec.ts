import { expect, test } from '@playwright/test';
import { criaUsuario, senhaNova } from './apoio/banco';
import { entra, preencheLogin, sai } from './apoio/telas';
import { visitante } from './apoio/visitante';

// Cada arquivo e um visitante, com o IP dele: ver apoio/visitante.ts.
test.use({ extraHTTPHeaders: visitante('login') });

/** Login e logout (#29, #31). Um usuario por teste: o limite tambem e por e-mail. */

test('login: senha errada nao entra, senha certa entra', async ({ page }) => {
  const u = await criaUsuario('Login');

  await page.goto('/entrar');
  await preencheLogin(page, u.email, senhaNova());

  await expect(
    page.getByRole('alert').filter({ hasText: 'E-mail ou senha incorretos' })
  ).toBeVisible();
  await expect(page).toHaveURL(/\/entrar/);
  // Errar a senha nao obriga a redigitar o e-mail (#130).
  await expect(page.getByLabel('E-mail')).toHaveValue(u.email);

  await preencheLogin(page, u.email, u.senha);
  await page.waitForURL('**/conta');
  await expect(page.getByText(u.email)).toBeVisible();
});

test('login: rota de conta sem sessao leva ao login e volta para onde ia', async ({ page }) => {
  const u = await criaUsuario('Volta');

  await page.goto('/conta/pedidos');
  await expect(page).toHaveURL(/\/entrar\?next=%2Fconta%2Fpedidos/);

  await preencheLogin(page, u.email, u.senha);
  await page.waitForURL('**/conta/pedidos');
  await expect(page.getByRole('heading', { name: 'Pedidos' })).toBeVisible();
});

test('login: destino de fora do site e ignorado', async ({ page }) => {
  const u = await criaUsuario('Destino');

  await page.goto(`/entrar?next=${encodeURIComponent('https://exemplo.invalid/conta')}`);
  await preencheLogin(page, u.email, u.senha);

  await page.waitForURL('**/conta');
  expect(new URL(page.url()).origin).toBe(new URL(test.info().project.use.baseURL ?? '').origin);
});

test('logout: a sessao acaba e a conta volta a pedir login', async ({ page, context }) => {
  const u = await criaUsuario('Saida');

  await entra(page, u.email, u.senha);
  const antes = await context.cookies();
  expect(antes.some((c) => c.name.includes('auth-token'))).toBe(true);

  await sai(page);

  const depois = await context.cookies();
  expect(depois.filter((c) => c.name.includes('auth-token') && c.value)).toEqual([]);

  await page.goto('/conta');
  await expect(page).toHaveURL(/\/entrar/);
});

test('logout: o cookie de antes da saida nao abre mais a conta', async ({ page, context }) => {
  const u = await criaUsuario('Revogada');

  await entra(page, u.email, u.senha);
  const guardados = await context.cookies();

  await sai(page);

  // Quem copiou o cookie antes do logout tenta usar depois. Sair so do
  // navegador deixaria esta porta aberta; sair de verdade revoga no servidor.
  await context.addCookies(guardados);
  await page.goto('/conta');
  await expect(page).toHaveURL(/\/entrar/);
});
