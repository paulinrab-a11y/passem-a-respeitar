import { expect, type Page, test } from '@playwright/test';
import {
  criaPendente,
  criaUsuario,
  emailConfirmado,
  emailNovo,
  leAceiteDaConta,
} from './apoio/banco';
import { codigoDoEmail, quantosPara } from './apoio/correio';
import { preencheLogin, sai, vivo } from './apoio/telas';
import { visitante } from './apoio/visitante';

// Cada arquivo e um visitante, com o IP dele: ver apoio/visitante.ts.
test.use({ extraHTTPHeaders: visitante('entrar-com-codigo') });

/**
 * Entrar sem senha, com um codigo no e-mail (#387), de ponta a ponta.
 *
 * Quem chega ao checkout sem sessao cai no login, e ali a porta que abre
 * primeiro e o codigo: e-mail, aceite da politica, oito digitos e de volta ao
 * checkout com o item escolhido. Conta nova nasce com o aceite carimbado;
 * conta pendente com a senha de outra pessoa (#284) perde essa senha; conta
 * confirmada entra e fica com a senha que tinha.
 */

const CHECKOUT = '/checkout?p=camiseta-cbac&tam=M&q=1';

/**
 * Entra com a senha depois de o widget da Cloudflare chegar. Ele entra acima
 * do botao quando carrega, e um clique no meio da chegada se perde.
 */
async function entraComSenha(page: Page, email: string, senha: string) {
  await page.goto('/entrar');
  await expect(page.locator('input[name="cf-turnstile-response"]')).not.toHaveValue('');
  await preencheLogin(page, email, senha);
}

/** Pede o codigo pela tela, e so devolve com a tela do codigo aberta. */
async function pedeCodigo(page: Page, email: string) {
  const receber = await vivo(page.getByRole('button', { name: 'Receber código' }));
  await page.getByLabel('E-mail').fill(email);
  await page.getByRole('checkbox', { name: /Li e aceito/ }).check();
  await receber.click();
  await expect(page.getByText('Confira seu e-mail')).toBeVisible();
  return vivo(page.getByLabel(/Código de 8 dígitos/));
}

test('checkout sem sessao: e-mail, codigo e de volta ao checkout, com conta nova e aceite', async ({
  page,
}) => {
  const email = emailNovo('codigo-novo');

  // Comprar sem sessao leva ao login, com o destino na URL. A porta e o
  // codigo, sem campo de senha.
  await page.goto(CHECKOUT);
  await page.waitForURL(/\/entrar\?next=%2Fcheckout/);
  await expect(page.getByLabel('Senha', { exact: true })).toHaveCount(0);

  // Sem o aceite, nada sai.
  const receber = await vivo(page.getByRole('button', { name: 'Receber código' }));
  await page.getByLabel('E-mail').fill(email);
  await receber.click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'política de privacidade' })
  ).toBeVisible();
  expect(await quantosPara(email)).toBe(0);
  expect(await leAceiteDaConta(email)).toBeUndefined();

  const antes = Date.now() - 1000;
  const campo = await pedeCodigo(page, email);

  // Codigo errado: erro na tela, campo limpo, sem sessao.
  await campo.fill('00000000');
  await expect(page.getByRole('alert').filter({ hasText: 'inválido ou vencido' })).toBeVisible();
  await expect(campo).toHaveValue('');

  // Oito digitos: envia sozinho e volta ao checkout com o item escolhido.
  await campo.fill(await codigoDoEmail(email, antes));
  await page.waitForURL(`**${CHECKOUT}`);
  await expect(page.getByLabel('Quem recebe')).toBeVisible();

  // A conta nasceu confirmada pelo codigo, com o aceite carimbado pelo banco.
  expect(await emailConfirmado(email)).toBe(true);
  const aceite = await leAceiteDaConta(email);
  expect(aceite).toBeTruthy();
  expect(Date.parse(aceite ?? '')).toBeGreaterThanOrEqual(antes - 60_000);

  // A senha aleatoria que o Supabase poe na conta do codigo e trocada por
  // outra que ninguem conhece. Quem nunca teve senha nao recebe
  // "Sua senha foi trocada" por isso.
  await page.waitForTimeout(1500);
  expect(await quantosPara(email, { assunto: 'Sua senha foi trocada' })).toBe(0);
});

test('conta pendente com a senha de outra pessoa: entrar pelo codigo tira essa senha', async ({
  page,
}) => {
  // Alguem cadastrou o e-mail com a senha dele e nunca confirmou (#284).
  const pendente = await criaPendente('Sequestro');

  await page.goto(`/entrar?next=${encodeURIComponent(CHECKOUT)}`);
  const antes = Date.now() - 1000;
  const campo = await pedeCodigo(page, pendente.email);
  await campo.fill(await codigoDoEmail(pendente.email, antes));
  await page.waitForURL(`**${CHECKOUT}`);
  expect(await emailConfirmado(pendente.email)).toBe(true);

  // A senha de quem cadastrou primeiro nao entra mais: a resposta de qualquer
  // senha errada, sem tela de codigo.
  await sai(page);
  await entraComSenha(page, pendente.email, pendente.senha);
  await expect(
    page.getByRole('alert').filter({ hasText: 'E-mail ou senha incorretos' })
  ).toBeVisible();
  await expect(page.getByLabel(/Código de 8 dígitos/)).toHaveCount(0);
});

test('conta confirmada entra pelo codigo no login normal e continua com a senha dela', async ({
  page,
}) => {
  const u = await criaUsuario('Codigo');

  // No login normal a senha abre primeiro; o codigo esta a um clique.
  await page.goto('/entrar');
  await (await vivo(page.getByRole('button', { name: 'Receber um código por e-mail' }))).click();
  const antes = Date.now() - 1000;
  const campo = await pedeCodigo(page, u.email);
  await campo.fill(await codigoDoEmail(u.email, antes));
  await page.waitForURL('**/conta');
  await expect(page.getByText(u.email)).toBeVisible();

  // A senha que ela escolheu no cadastro continua valendo.
  await sai(page);
  await entraComSenha(page, u.email, u.senha);
  await page.waitForURL('**/conta');
});
