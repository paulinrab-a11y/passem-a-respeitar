import { expect, test } from '@playwright/test';
import { criaUsuario, senhaNova } from './apoio/banco';
import { linkDoEmail } from './apoio/correio';
import { entra, preencheLogin, sai, vivo } from './apoio/telas';

/** Troca de senha (#25) e recuperacao de senha (#32). */

test('troca de senha: exige a atual, e depois so a nova entra', async ({ page }) => {
  const u = await criaUsuario('Troca');
  const nova = senhaNova();

  await entra(page, u.email, u.senha);
  await page.goto('/conta/seguranca');

  const trocar = await vivo(page.getByRole('button', { name: 'Trocar senha' }));
  const atual = page.getByLabel('Senha atual');
  const novaSenha = page.getByLabel('Nova senha', { exact: true });
  const confirmacao = page.getByLabel('Confirmar nova senha');

  // Sessao aberta nao basta: quem sentou no computador alheio nao sabe a senha.
  await atual.fill(senhaNova());
  await novaSenha.fill(nova);
  await confirmacao.fill(nova);
  await trocar.click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'A senha atual está incorreta' })
  ).toBeVisible();

  await atual.fill(u.senha);
  await trocar.click();
  await expect(page.getByRole('status').filter({ hasText: 'Senha trocada' })).toBeVisible();

  // Quem trocou continua dentro.
  await page.goto('/conta');
  await expect(page.getByText(u.email)).toBeVisible();

  await sai(page);

  await page.goto('/entrar');
  await preencheLogin(page, u.email, u.senha);
  await expect(
    page.getByRole('alert').filter({ hasText: 'E-mail ou senha incorretos' })
  ).toBeVisible();

  await preencheLogin(page, u.email, nova);
  await page.waitForURL('**/conta');
  await expect(page.getByText(u.email)).toBeVisible();
});

test('recuperacao de senha: o link do e-mail leva a uma senha nova', async ({ page }) => {
  const u = await criaUsuario('Esqueci');
  const nova = senhaNova();
  const pedidoEm = Date.now() - 1000;

  await page.goto('/recuperar-senha');
  const enviar = await vivo(page.getByRole('button', { name: 'Enviar link' }));
  await page.getByLabel('E-mail da conta').fill(u.email);
  await enviar.click();
  await expect(page.getByText('Confira seu e-mail')).toBeVisible();

  await page.goto(await linkDoEmail(u.email, pedidoEm));
  await page.waitForURL('**/redefinir-senha');

  const salvar = await vivo(page.getByRole('button', { name: 'Salvar nova senha' }));
  await page.getByLabel('Nova senha', { exact: true }).fill(nova);
  await page.getByLabel('Confirme a nova senha').fill(nova);
  await salvar.click();

  await page.waitForURL('**/conta');
  await expect(page.getByText(u.email)).toBeVisible();

  await sai(page);

  await page.goto('/entrar');
  await preencheLogin(page, u.email, u.senha);
  await expect(
    page.getByRole('alert').filter({ hasText: 'E-mail ou senha incorretos' })
  ).toBeVisible();

  await preencheLogin(page, u.email, nova);
  await page.waitForURL('**/conta');
});

test('recuperacao de senha: e-mail sem conta recebe a mesma resposta', async ({ page }) => {
  await page.goto('/recuperar-senha');
  const enviar = await vivo(page.getByRole('button', { name: 'Enviar link' }));
  await page.getByLabel('E-mail da conta').fill('ninguem-com-este-endereco@e2e.test');
  await enviar.click();

  // Dizer "nao achei esse e-mail" contaria a quem pergunta quem e cliente.
  await expect(page.getByText('Confira seu e-mail')).toBeVisible();
});

test('recuperacao de senha: sem o link nao ha formulario de senha nova', async ({ page }) => {
  await page.goto('/redefinir-senha');

  await expect(page.getByText('Esse link não vale mais')).toBeVisible();
  await expect(page.getByLabel('Nova senha', { exact: true })).toHaveCount(0);
});
