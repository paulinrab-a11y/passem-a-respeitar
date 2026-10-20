import { expect, test } from '@playwright/test';
import { emailNovo, senhaNova } from './apoio/banco';
import { codigoDoEmail, quantosPara } from './apoio/correio';
import { preencheLogin, sai, vivo } from './apoio/telas';
import { visitante } from './apoio/visitante';

// Cada arquivo e um visitante, com o IP dele: ver apoio/visitante.ts.
test.use({ extraHTTPHeaders: visitante('criar-senha') });

/**
 * Criar senha em Seguranca (#389), de ponta a ponta.
 *
 * A conta que nasce pelo codigo do e-mail (#387) fica com uma senha que
 * ninguem conhece. Em Seguranca ela ve "Criar senha", e nao "Trocar senha",
 * que pediria a atual. Com um codigo novo no e-mail ela cria a senha, a tela
 * vira "Trocar senha", e a senha nova entra pelo login.
 */
test('conta criada pelo codigo: cria a senha em Seguranca e entra com ela', async ({ page }) => {
  const email = emailNovo('criar-senha');
  const senha = senhaNova();

  // Entra pelo codigo, com um e-mail que ainda nao tem conta.
  await page.goto('/entrar');
  await (await vivo(page.getByRole('button', { name: 'receba um código' }))).click();
  const receber = await vivo(page.getByRole('button', { name: 'Receber código' }));
  await page.getByLabel('E-mail').fill(email);
  await page.getByRole('checkbox', { name: /Li e aceito/ }).check();
  const antes = Date.now() - 1000;
  await receber.click();
  const campoDaEntrada = await vivo(page.getByLabel(/Código de 8 dígitos/));
  await campoDaEntrada.fill(await codigoDoEmail(email, antes));
  await page.waitForURL('**/conta');

  // Seguranca mostra "Criar senha", sem o campo da senha atual.
  await page.goto('/conta/seguranca');
  await expect(page.getByText('Criar senha', { exact: true }).first()).toBeVisible();
  await expect(page.getByLabel('Senha atual')).toHaveCount(0);

  // Um codigo novo, para o e-mail da sessao.
  const enviar = await vivo(page.getByRole('button', { name: 'Enviar código' }));
  const antesDoCodigo = Date.now() - 1000;
  await enviar.click();
  await expect(page.getByRole('status').filter({ hasText: 'Enviamos um código' })).toBeVisible();
  const codigo = await codigoDoEmail(email, antesDoCodigo);

  // Codigo errado nao cria nada.
  await page.getByLabel('Código do e-mail').fill(codigo === '00000000' ? '11111111' : '00000000');
  await page.getByLabel('Nova senha', { exact: true }).fill(senha);
  await page.getByLabel('Confirmar nova senha').fill(senha);
  await page.getByRole('button', { name: 'Criar senha' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'inválido ou vencido' })).toBeVisible();
  await expect(page.getByLabel('Código do e-mail')).toHaveValue('');

  // O codigo certo cria a senha, e a tela vira "Trocar senha".
  await page.getByLabel('Código do e-mail').fill(codigo);
  await page.getByRole('button', { name: 'Criar senha' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Senha criada' })).toBeVisible();
  await expect(page.getByLabel('Senha atual')).toBeVisible();

  // Quem decide e o servidor: recarregada, a pagina continua em "Trocar senha".
  await page.reload();
  await expect(page.getByLabel('Senha atual')).toBeVisible();
  await expect(page.getByLabel('Código do e-mail')).toHaveCount(0);

  // A sessao continua viva depois de criar a senha, e o Supabase nao mandou
  // "Sua senha foi trocada" a quem nunca teve senha.
  expect(await quantosPara(email, { assunto: 'Sua senha foi trocada' })).toBe(0);

  // Sai e entra com a senha nova.
  await sai(page);
  await page.goto('/entrar');
  // O widget da Cloudflare entra acima do botao; o clique no meio se perde.
  await expect(page.locator('input[name="cf-turnstile-response"]')).not.toHaveValue('');
  await preencheLogin(page, email, senha);
  await page.waitForURL('**/conta');
  await expect(page.getByText(email)).toBeVisible();
});
