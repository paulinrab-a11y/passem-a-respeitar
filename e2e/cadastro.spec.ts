import { expect, test } from '@playwright/test';
import { emailConfirmado, emailNovo, senhaNova } from './apoio/banco';
import { codigoDoEmail, linkDoEmail } from './apoio/correio';
import { preencheLogin, vivo } from './apoio/telas';
import { visitante } from './apoio/visitante';

// Cada arquivo e um visitante, com o IP dele: ver apoio/visitante.ts.
test.use({ extraHTTPHeaders: visitante('cadastro') });

/**
 * Cadastro (#30), de ponta a ponta: formulario, e-mail, link, conta.
 *
 * E o unico teste que cria conta pela tela. O limite de cadastro e de cinco
 * por hora por IP, e a suite inteira e um IP so.
 */
test('cadastro: a conta so entra depois do link do e-mail', async ({ page }) => {
  const email = emailNovo('cadastro');
  const senha = senhaNova();

  await page.goto('/criar-conta');
  const criar = await vivo(page.getByRole('button', { name: 'Criar conta' }));
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(senha);
  await page.getByLabel('Confirme a senha').fill(senha);
  await page.getByRole('checkbox', { name: /Li e aceito/ }).check();
  await criar.click();

  await expect(page.getByText('Confira seu e-mail')).toBeVisible();
  // Lido do banco, e nao da tela: a tela diz o mesmo para e-mail repetido.
  expect(await emailConfirmado(email)).toBe(false);

  // Com a senha certa e sem confirmar, a porta continua fechada — e a
  // resposta e a de credencial errada, que nao conta se a conta existe.
  await page.goto('/entrar');
  await preencheLogin(page, email, senha);
  await expect(
    page.getByRole('alert').filter({ hasText: 'E-mail ou senha incorretos' })
  ).toBeVisible();
  await expect(page).toHaveURL(/\/entrar/);

  // O link volta pelo callback, que troca o codigo pela sessao.
  await page.goto(await linkDoEmail(email));
  await page.waitForURL('**/conta');

  // Sem nome no cadastro (#207): a conta nasce sem ele, e a tela diz isso.
  await expect(page.getByText('Sem nome')).toBeVisible();
  await expect(page.getByText(email)).toBeVisible();
  await expect(page.getByText('verificado', { exact: true })).toBeVisible();
  expect(await emailConfirmado(email)).toBe(true);
});

test('cadastro: sem aceitar a politica de privacidade nao ha conta', async ({ page }) => {
  const email = emailNovo('sem-aceite');
  const senha = senhaNova();

  await page.goto('/criar-conta');
  const criar = await vivo(page.getByRole('button', { name: 'Criar conta' }));
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(senha);
  await page.getByLabel('Confirme a senha').fill(senha);
  await criar.click();

  await expect(
    page.getByRole('alert').filter({ hasText: 'aceitar a política de privacidade' })
  ).toBeVisible();

  // O que ja foi digitado continua la (#130).
  await expect(page.getByLabel('E-mail')).toHaveValue(email);
});

/**
 * Cadastro pelo codigo (#224): o mesmo e-mail traz codigo e link. Aqui a
 * pessoa digita o codigo — e o campo envia sozinho no sexto digito.
 */
test('cadastro: digitar o codigo do e-mail confirma e entra na conta', async ({ page }) => {
  const email = emailNovo('codigo');
  const senha = senhaNova();

  await page.goto('/criar-conta');
  const criar = await vivo(page.getByRole('button', { name: 'Criar conta' }));
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(senha);
  await page.getByLabel('Confirme a senha').fill(senha);
  await page.getByRole('checkbox', { name: /Li e aceito/ }).check();
  await criar.click();

  const campo = await vivo(page.getByLabel(/Código de 6 dígitos/));
  // Reenviar espera os 60 s do Supabase, e a tela mostra a contagem.
  await expect(page.getByRole('button', { name: /Reenviar código \(\d+ s\)/ })).toBeDisabled();

  // Codigo errado: erro na tela, campo limpo, mesma tela.
  await campo.fill('000000');
  await expect(page.getByRole('alert').filter({ hasText: 'inválido ou vencido' })).toBeVisible();
  await expect(campo).toHaveValue('');
  expect(await emailConfirmado(email)).toBe(false);

  // O codigo certo, lido do e-mail de verdade. Seis digitos: envia sozinho.
  await campo.fill(await codigoDoEmail(email));
  await page.waitForURL('**/conta');
  await expect(page.getByText(email)).toBeVisible();
  expect(await emailConfirmado(email)).toBe(true);
});
