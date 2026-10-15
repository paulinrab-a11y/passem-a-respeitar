import { expect, type Page, test } from '@playwright/test';
import { emailConfirmado, emailNovo, senhaNova } from './apoio/banco';
import { codigoDoEmail, emailPara, quantosPara } from './apoio/correio';
import { entra, preencheLogin, sai, vivo } from './apoio/telas';
import { visitante } from './apoio/visitante';

// Cada arquivo e um visitante, com o IP dele: ver apoio/visitante.ts.
test.use({ extraHTTPHeaders: visitante('pre-sequestro') });

/**
 * Pre-sequestro de conta (#284), de ponta a ponta.
 *
 * Alguem cadastra o e-mail de outra pessoa com uma senha DELE e nao
 * confirma. Quando a dona do e-mail se cadastra, o Supabase nao mexe na conta
 * pendente: manda um codigo novo e descarta a senha que ela digitou. Antes da
 * #284, confirmar pelo codigo deixava a conta dela no e-mail e dele na
 * senha. Agora o codigo grava a senha de quem confirma.
 *
 * Os dois cadastros sao pela tela, como no ataque: a conta pendente feita
 * pelo admin (apoio/banco.ts) nao passa pelo signUp que descarta a senha, e
 * e esse descarte que o teste precisa atravessar. Num arquivo proprio, com o
 * IP dele, para os dois nao gastarem a cota de cadastros de cadastro.spec.ts.
 */

async function cadastra(page: Page, email: string, senha: string) {
  await page.goto('/criar-conta');
  const criar = await vivo(page.getByRole('button', { name: 'Criar conta' }));
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(senha);
  await page.getByLabel('Confirme a senha').fill(senha);
  await page.getByRole('checkbox', { name: /Li e aceito/ }).check();
  await criar.click();
  await expect(page.getByText('Confira seu e-mail')).toBeVisible();
}

test('cadastro: o codigo grava a senha de quem confirma, e a do primeiro cadastro deixa de valer', async ({
  browser,
  page,
}) => {
  const email = emailNovo('pre-sequestro');
  const doOutro = senhaNova();
  const daDona = senhaNova();

  // Outra pessoa, em outro navegador, cadastra o e-mail com a senha dela e
  // fecha a tela do codigo, que nunca vai receber.
  const outro = await browser.newContext({ extraHTTPHeaders: visitante('pre-sequestro') });
  await cadastra(await outro.newPage(), email, doOutro);
  const primeiroEm = Date.now();
  await outro.close();
  // Lido do banco, e nao da tela: a tela diz o mesmo para e-mail repetido.
  expect(await emailConfirmado(email)).toBe(false);

  // A dona do e-mail se cadastra com a dela. O Supabase local recusa um
  // segundo e-mail para a mesma caixa dentro de 1 s (`max_frequency`), e
  // aqui o codigo que vale e o do segundo cadastro.
  await page.waitForTimeout(Math.max(0, primeiroEm + 1100 - Date.now()));
  await cadastra(page, email, daDona);
  await expect.poll(() => quantosPara(email)).toBe(2);

  // O codigo do e-mail mais recente. Oito digitos: envia sozinho.
  const campo = await vivo(page.getByLabel(/Código de 8 dígitos/));
  const confirmadoEm = Date.now() - 1000;
  await campo.fill(await codigoDoEmail(email));
  await page.waitForURL('**/conta');
  await expect(page.getByText(email)).toBeVisible();
  expect(await emailConfirmado(email)).toBe(true);

  // A senha da conta mudou de verdade, e o Supabase avisa a dona como em
  // qualquer troca de senha.
  const aviso = await emailPara(email, { desde: confirmadoEm, assunto: 'Sua senha foi trocada' });
  expect(aviso.lido).toContain(email);

  // A senha de quem cadastrou primeiro nao entra mais: mesma resposta de
  // qualquer senha errada, sem tela de codigo. A da dona entra.
  await sai(page);
  await page.goto('/entrar');
  await preencheLogin(page, email, doOutro);
  await expect(
    page.getByRole('alert').filter({ hasText: 'E-mail ou senha incorretos' })
  ).toBeVisible();
  await expect(page.getByLabel(/Código de 8 dígitos/)).toHaveCount(0);

  await entra(page, email, daDona);
});
