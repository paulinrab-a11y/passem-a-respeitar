import { expect, type Page, test } from '@playwright/test';
import { criaPendente, emailConfirmado, emailNovo, senhaNova } from './apoio/banco';
import { codigoDoEmail, linkDoEmail, quantosPara } from './apoio/correio';
import { preencheLogin, vivo } from './apoio/telas';
import { visitante } from './apoio/visitante';

// Cada arquivo e um visitante, com o IP dele: ver apoio/visitante.ts.
test.use({ extraHTTPHeaders: visitante('confirmar-email') });

/**
 * Confirmar o e-mail depois de sair da tela do codigo do cadastro (#260).
 *
 * O caminho de volta e o login com a senha certa. O que faz isso nao virar
 * oraculo de cadastro e o Supabase conferir a senha ANTES de olhar a
 * confirmacao: sem a senha, conta pendente, conta confirmada e e-mail que nao
 * existe recebem a mesma resposta. O teste da senha errada em conta pendente
 * e o que pega o dia em que essa ordem mudar.
 *
 * As contas pendentes nascem pelo admin, sem `email_confirm`: o Supabase as
 * trata igual a de quem se cadastrou pela tela, e o cadastro pela tela gasta
 * um dos cinco por hora do IP. O cadastro de verdade esta em cadastro.spec.ts.
 */

/** O erro do login, inteiro: e ele que tem de ser igual nos casos sem senha. */
async function erroDoLogin(page: Page) {
  const alerta = page.getByRole('alert').filter({ hasText: 'E-mail ou senha incorretos' });
  await expect(alerta).toBeVisible();
  return (await alerta.textContent())?.trim();
}

test('confirmar: sem a senha, conta pendente e e-mail desconhecido sao iguais', async ({
  page,
}) => {
  const pendente = await criaPendente('Pendente');
  const desde = Date.now() - 1000;

  await page.goto('/entrar');
  await preencheLogin(page, pendente.email, senhaNova());
  const paraPendente = await erroDoLogin(page);

  await page.goto('/entrar');
  await preencheLogin(page, emailNovo('ninguem'), senhaNova());
  const paraDesconhecido = await erroDoLogin(page);

  expect(paraPendente).toBe(paraDesconhecido);
  // O caminho que a mensagem ensina e a recuperacao, e nao cadastrar de novo.
  expect(paraPendente).toContain('Esqueci minha senha');
  await expect(page.getByLabel(/Código de 8 dígitos/)).toHaveCount(0);

  // Nenhum codigo saiu para a conta pendente: a acao ja respondeu, e o
  // e-mail, se saisse, sairia antes da resposta. A folga cobre a entrega ao
  // correio local.
  await page.waitForTimeout(500);
  expect(await quantosPara(pendente.email, { desde })).toBe(0);
  expect(await emailConfirmado(pendente.email)).toBe(false);
});

test('confirmar: a senha certa abre o codigo e leva ao checkout, conectado', async ({
  page,
  context,
}) => {
  const pendente = await criaPendente('Checkout');
  const checkout = '/checkout?p=camiseta-cbac&tam=M&q=1';

  // Quem clica em Comprar sem sessao cai no login com o destino na URL.
  await page.goto(`/entrar?next=${encodeURIComponent(checkout)}`);
  await vivo(page.getByRole('button', { name: 'Entrar' }));
  await page.getByRole('checkbox', { name: 'Manter conectado' }).check();
  await preencheLogin(page, pendente.email, pendente.senha);

  await expect(page.getByText('Sua conta ainda não foi confirmada')).toBeVisible();
  const campo = await vivo(page.getByLabel(/Código de 8 dígitos/));
  await expect(campo).toBeFocused();
  // Reenviar espera os 60 s do Supabase: um codigo acabou de sair.
  await expect(page.getByRole('button', { name: /Reenviar código \(\d+ s\)/ })).toBeDisabled();

  // Voltar devolve o formulario como estava; entrar de novo traz o codigo.
  //
  // O botao fica abaixo da dobra, e o clique do Playwright logo depois de
  // rolar a pagina se perdia enquanto o widget da Cloudflare carregava:
  // nenhum evento de ponteiro chegava ao documento (medido com ouvintes em
  // captura, 3 de 4 rodadas). Rolar antes e esperar dois quadros resolveu em
  // 10 de 10. Pessoa nenhuma rola e toca no mesmo milissegundo.
  const voltar = page.getByRole('button', { name: 'Voltar' });
  await voltar.scrollIntoViewIfNeeded();
  await page.evaluate(
    () => new Promise((pronto) => requestAnimationFrame(() => requestAnimationFrame(pronto)))
  );
  await voltar.click();
  await expect(page.getByLabel('E-mail')).toHaveValue(pendente.email);
  await expect(page.getByRole('checkbox', { name: 'Manter conectado' })).toBeChecked();
  await page.getByLabel('Senha', { exact: true }).fill(pendente.senha);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByText('Sua conta ainda não foi confirmada')).toBeVisible();

  // Codigo errado: erro na tela, campo limpo, nada confirmado.
  await campo.fill('00000000');
  await expect(page.getByRole('alert').filter({ hasText: 'inválido ou vencido' })).toBeVisible();
  await expect(campo).toHaveValue('');
  expect(await emailConfirmado(pendente.email)).toBe(false);

  // O codigo do e-mail mais recente. Oito digitos: envia sozinho, e o destino
  // que o login trazia continua valendo.
  await campo.fill(await codigoDoEmail(pendente.email));
  await page.waitForURL(`**${checkout}`);
  await expect(page.getByLabel('Quem recebe')).toBeVisible();
  expect(await emailConfirmado(pendente.email)).toBe(true);

  // "Manter conectado" marcado antes do codigo continua valendo depois dele.
  const lembrar = (await context.cookies()).find((c) => c.name === 'par_lembrar');
  expect(lembrar?.value).toBe('1');
});

test('confirmar: o link de "Esqueci minha senha" confirma a conta pendente', async ({ page }) => {
  const pendente = await criaPendente('Recupera');
  const nova = senhaNova();
  const pedidoEm = Date.now() - 1000;

  // O que o erro do login ensina a quem nao lembra a senha.
  await page.goto('/recuperar-senha');
  await expect(page.getByText('Ainda não confirmou o e-mail da conta?')).toBeVisible();
  const enviar = await vivo(page.getByRole('button', { name: 'Enviar link' }));
  await page.getByLabel('E-mail da conta').fill(pendente.email);
  await enviar.click();
  await expect(page.getByText('Confira seu e-mail')).toBeVisible();

  await page.goto(await linkDoEmail(pendente.email, pedidoEm));
  await page.waitForURL('**/redefinir-senha');
  const salvar = await vivo(page.getByRole('button', { name: 'Salvar nova senha' }));
  await page.getByLabel('Nova senha', { exact: true }).fill(nova);
  await page.getByLabel('Confirme a nova senha').fill(nova);
  await salvar.click();
  await page.waitForURL('**/conta');

  await expect(page.getByText('verificado', { exact: true })).toBeVisible();
  expect(await emailConfirmado(pendente.email)).toBe(true);
});
