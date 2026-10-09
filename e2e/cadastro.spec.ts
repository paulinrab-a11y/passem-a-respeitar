import { expect, test } from '@playwright/test';
import { emailConfirmado, emailNovo, senhaNova } from './apoio/banco';
import { codigoDoEmail, quantosPara } from './apoio/correio';
import { preencheLogin, vivo } from './apoio/telas';
import { visitante } from './apoio/visitante';

// Cada arquivo e um visitante, com o IP dele: ver apoio/visitante.ts.
test.use({ extraHTTPHeaders: visitante('cadastro') });

/**
 * Cadastro (#30), de ponta a ponta: formulario, e-mail, codigo, conta.
 *
 * E o unico teste que cria conta pela tela. O limite de cadastro e de cinco
 * por hora por IP, e a suite inteira e um IP so.
 */
test('cadastro: quem saiu da tela do codigo confirma pelo login (#260)', async ({ page }) => {
  const email = emailNovo('cadastro');
  const senha = senhaNova();

  await page.goto('/criar-conta');
  const criar = await vivo(page.getByRole('button', { name: 'Criar conta' }));
  // O caminho de volta ja esta escrito antes do cadastro: cadastrar de novo
  // descartaria a senha nova.
  await expect(page.getByText('Criou a conta e não confirmou o e-mail?')).toBeVisible();
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(senha);
  await page.getByLabel('Confirme a senha').fill(senha);
  await page.getByRole('checkbox', { name: /Li e aceito/ }).check();
  await criar.click();
  await expect(page.getByText('Confira seu e-mail')).toBeVisible();
  const cadastradoEm = Date.now();
  // Lido do banco, e nao da tela: a tela diz o mesmo para e-mail repetido.
  expect(await emailConfirmado(email)).toBe(false);

  // Sai da tela do codigo: ela so existe no formulario do cadastro, e
  // recarregar, fechar a aba ou abrir o e-mail em outro aparelho a perde.
  // A volta e o login, com a senha: a tela do codigo aparece de novo, e um
  // codigo novo sai.
  await page.goto('/entrar');
  // O Supabase local recusa um segundo e-mail para a mesma caixa dentro de
  // 1 s (`max_frequency`). O login nao conta isso a ninguem — o codigo
  // anterior continua valendo —, mas aqui o que se prova e que o login
  // mandou um codigo NOVO.
  await page.waitForTimeout(Math.max(0, cadastradoEm + 1100 - Date.now()));
  await preencheLogin(page, email, senha);
  await expect(page.getByText('Sua conta ainda não foi confirmada')).toBeVisible();
  await expect(page).toHaveURL(/\/entrar/);
  // Dois e-mails: o do cadastro e o que o login acabou de mandar. E a tela
  // sabe que mandou: o "enviamos" vem da resposta do Supabase, nao de um
  // texto fixo.
  await expect.poll(() => quantosPara(email)).toBe(2);
  await expect(page.getByText(/Enviamos um código de 8 dígitos/)).toBeVisible();

  // O codigo novo, lido do e-mail de verdade — o mais recente; o anterior
  // deixou de valer. Oito digitos: envia sozinho.
  const campo = await vivo(page.getByLabel(/Código de 8 dígitos/));
  await expect(campo).toBeFocused();
  await campo.fill(await codigoDoEmail(email));
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
 * Cadastro pelo codigo (#224): desde a #227 o e-mail traz so o codigo. Aqui a
 * pessoa erra antes de acertar, e o campo envia sozinho no sexto digito.
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

  const campo = await vivo(page.getByLabel(/Código de 8 dígitos/));
  // Reenviar espera os 60 s do Supabase, e a tela mostra a contagem.
  await expect(page.getByRole('button', { name: /Reenviar código \(\d+ s\)/ })).toBeDisabled();

  // Codigo errado: erro na tela, campo limpo, mesma tela.
  await campo.fill('00000000');
  await expect(page.getByRole('alert').filter({ hasText: 'inválido ou vencido' })).toBeVisible();
  await expect(campo).toHaveValue('');
  expect(await emailConfirmado(email)).toBe(false);

  // O codigo certo, lido do e-mail de verdade. Seis digitos: envia sozinho.
  await campo.fill(await codigoDoEmail(email));
  await page.waitForURL('**/conta');
  await expect(page.getByText(email)).toBeVisible();
  expect(await emailConfirmado(email)).toBe(true);
});
