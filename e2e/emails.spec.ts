import { expect, test } from '@playwright/test';
import { CONTATO, EMAILS } from '../supabase/templates/modelos.mjs';
import { SITE } from './apoio/ambiente.mjs';
import { criaUsuario, emailDoUsuario, emailNovo, senhaNova } from './apoio/banco';
import { type Email, emailPara, quantosPara } from './apoio/correio';
import { entra, vivo } from './apoio/telas';
import { visitante } from './apoio/visitante';

/**
 * Os e-mails de conta (#183, #185): o que chega na caixa de entrada.
 *
 * Dos treze modelos, o site dispara cinco, e sao esses que este arquivo le.
 * Os outros oito nao tem como sair: o site nao tem convite, login por link,
 * telefone, login social nem verificacao em duas etapas. Deles, o teste de
 * unidade confere o texto e as variaveis.
 *
 * O texto esperado sai de supabase/templates/modelos.mjs, que e de onde os
 * modelos saem. O que o teste prova nao e que o texto e igual a si mesmo: e
 * que o Supabase esta mandando ESTE modelo, com as variaveis preenchidas, e
 * nao o padrao dele em ingles.
 */
test.use({ extraHTTPHeaders: visitante('emails') });

type Chave = (typeof EMAILS)[number]['chave'];

const modelo = (chave: Chave) => {
  const achado = EMAILS.find((e) => e.chave === chave);
  if (!achado) throw new Error(`sem modelo: ${chave}`);
  return achado;
};

/** Frases dos modelos padrao do Supabase. Nenhuma pode aparecer. */
const EM_INGLES = [
  'Confirm your',
  'Follow this link',
  'Reset Password',
  'Reset password',
  'Magic Link',
  'Change Email',
  'You have been invited',
  'Your password has been changed',
];

function confere(email: Email, chave: Chave) {
  const m = modelo(chave);

  expect(email.assunto).toBe(m.assunto);
  expect(email.html).toContain('<html lang="pt-BR">');
  expect(email.lido).toContain(m.titulo);
  expect(email.lido).toContain('Passem a Respeitar');
  expect(email.lido).toContain(CONTATO);

  // Variavel que o Supabase nao preencheu sairia escrita no e-mail.
  expect(email.html).not.toContain('{{');
  expect(email.html).not.toContain('}}');

  for (const frase of EM_INGLES) expect(email.lido).not.toContain(frase);

  // Nenhuma imagem e nada de fora: o e-mail chega inteiro com imagem
  // bloqueada, e nao avisa ninguem de que foi aberto.
  expect(email.html).not.toMatch(/<img\b/i);
  expect(email.html).not.toMatch(/<link\b|<script\b|@import|url\(/i);
}

test('e-mail de cadastro: em portugues, so com o codigo', async ({ page }) => {
  const email = emailNovo('carta-cadastro');
  const senha = senhaNova();

  await page.goto('/criar-conta');
  const criar = await vivo(page.getByRole('button', { name: 'Criar conta' }));
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(senha);
  await page.getByLabel('Confirme a senha').fill(senha);
  await page.getByRole('checkbox', { name: /Li e aceito/ }).check();
  await criar.click();
  await expect(page.getByText('Confira seu e-mail')).toBeVisible();

  const carta = await emailPara(email);

  confere(carta, 'confirmation');
  // So o codigo, sem link (#227).
  expect(carta.lido).toContain('Sem o código, nenhuma conta é criada');
  expect(carta.lido).toMatch(/digite este código no site: \d{6}\b/);
  expect(carta.link).toBeNull();
  expect(carta.html).not.toContain('/auth/v1/verify?');
});

test('e-mail de recuperacao: em portugues; endereco sem conta nao recebe nada', async ({
  page,
}) => {
  const u = await criaUsuario('CartaEsqueci');
  const semConta = emailNovo('carta-sem-conta');

  for (const endereco of [u.email, semConta]) {
    await page.goto('/recuperar-senha');
    const enviar = await vivo(page.getByRole('button', { name: 'Enviar link' }));
    await page.getByLabel('E-mail da conta').fill(endereco);
    await enviar.click();
    await expect(page.getByText('Confira seu e-mail')).toBeVisible();
  }

  const carta = await emailPara(u.email);

  confere(carta, 'recovery');
  expect(carta.lido).toContain('Criar senha nova');
  expect(carta.lido).toContain('Sua senha continua a mesma');
  expect(carta.link).toContain('type=recovery');

  // A tela respondeu igual para os dois. A caixa de entrada e que difere: e
  // quem nao tem conta nao recebe e-mail dizendo que nao tem.
  expect(await quantosPara(semConta)).toBe(0);
});

test('troca de senha e de e-mail: os pedidos, as confirmacoes e os avisos', async ({ page }) => {
  test.setTimeout(90_000);

  const u = await criaUsuario('CartaTroca');
  const senha = senhaNova();
  const destino = emailNovo('carta-destino');

  await entra(page, u.email, u.senha);
  await page.goto('/conta/seguranca');

  // --- Senha --------------------------------------------------------------
  const trocarSenha = await vivo(page.getByRole('button', { name: 'Trocar senha' }));
  await page.getByLabel('Senha atual').fill(u.senha);
  await page.getByLabel('Nova senha', { exact: true }).fill(senha);
  await page.getByLabel('Confirmar nova senha').fill(senha);
  await trocarSenha.click();
  await expect(page.getByRole('status').filter({ hasText: 'Senha trocada' })).toBeVisible();

  const avisoDaSenha = await emailPara(u.email, { assunto: 'Sua senha foi trocada' });

  confere(avisoDaSenha, 'password_changed');
  expect(avisoDaSenha.lido).toContain(`A senha da conta ${u.email} acabou de ser trocada`);
  // O botao "Nao fui eu" leva ao pedido de senha nova, no proprio site.
  expect(avisoDaSenha.html).toContain(`href="${SITE}/recuperar-senha"`);

  // --- E-mail: o pedido ---------------------------------------------------
  const trocarEmail = await vivo(page.getByRole('button', { name: 'Trocar e-mail' }));
  await page.getByLabel('Novo e-mail').fill(destino);
  await page.getByLabel('Sua senha, para confirmar').fill(senha);
  await trocarEmail.click();
  await expect(page.getByText('Troca pendente para')).toBeVisible();

  const filtro = { assunto: 'Confirme a troca de e-mail' };
  const paraOAtual = await emailPara(u.email, filtro);
  const paraONovo = await emailPara(destino, filtro);

  for (const carta of [paraOAtual, paraONovo]) {
    confere(carta, 'email_change');
    // Quem recebe ve de onde e para onde, nos dois enderecos.
    expect(carta.lido).toContain(`De: ${u.email}`);
    expect(carta.lido).toContain(`Para: ${destino}`);
    expect(carta.link).toContain('type=email_change');
  }
  // Cada endereco confirma com o link dele.
  expect(paraOAtual.link).not.toBe(paraONovo.link);

  // --- E-mail: uma confirmacao nao basta ----------------------------------
  await page.goto(String(paraOAtual.link));
  await page.waitForLoadState('load');
  expect(await emailDoUsuario(u.id)).toBe(u.email);

  // --- E-mail: as duas, e o aviso -----------------------------------------
  await page.goto(String(paraONovo.link));
  await page.waitForLoadState('load');
  await expect.poll(() => emailDoUsuario(u.id)).toBe(destino);

  // O aviso vai para o endereco ANTIGO: e quem precisa saber, se nao foi ele.
  const avisoDoEmail = await emailPara(u.email, { assunto: 'O e-mail da sua conta foi trocado' });

  confere(avisoDoEmail, 'email_changed');
  expect(avisoDoEmail.lido).toContain(`Era: ${u.email}`);
  expect(avisoDoEmail.lido).toContain(`Agora é: ${destino}`);
});
