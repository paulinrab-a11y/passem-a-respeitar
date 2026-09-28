import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Gestos que se repetem entre os testes.
 *
 * Tudo aqui acha os campos como a pessoa acha: pelo rotulo e pelo nome do
 * botao. Seletor de classe passaria com um formulario sem label, que e
 * justamente o defeito que um teste de ponta a ponta consegue ver.
 */

/**
 * Espera o elemento estar vivo, e o devolve.
 *
 * O HTML chega antes do JavaScript. Os campos sao controlados pelo React:
 * texto digitado antes da hidratacao some quando ela acontece, e o teste
 * falharia por correr mais que qualquer pessoa. O React pendura as props no
 * elemento quando o assume, e e isso que se espera aqui.
 */
export async function vivo(alvo: Locator) {
  await expect(alvo).toBeVisible();
  await expect
    .poll(() => alvo.evaluate((el) => Object.keys(el).some((k) => k.startsWith('__reactProps'))))
    .toBe(true);
  return alvo;
}

export async function preencheLogin(page: Page, email: string, senha: string) {
  const entrar = await vivo(page.getByRole('button', { name: 'Entrar' }));
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(senha);
  await entrar.click();
}

/** Entra pela tela de login e so devolve com a conta na tela. */
export async function entra(page: Page, email: string, senha: string) {
  await page.goto('/entrar');
  await preencheLogin(page, email, senha);
  await page.waitForURL('**/conta');
  await expect(page.getByText(email)).toBeVisible();
}

/** Sai pelo botao da conta. O site devolve a pessoa para a home. */
export async function sai(page: Page) {
  await page.goto('/conta');
  const sair = await vivo(page.getByRole('button', { name: 'Sair', exact: true }));
  await sair.click();
  await page.waitForURL((url) => url.pathname === '/');
}
