import { expect, test } from '@playwright/test';
import {
  apagaPedido,
  criaPedido,
  criaUsuario,
  type Item,
  leDonoDoPedido,
  senhaNova,
  usuarioExiste,
} from './apoio/banco';
import { entra, preencheLogin, vivo } from './apoio/telas';
import { visitante } from './apoio/visitante';

// Cada arquivo e um visitante, com o IP dele: ver apoio/visitante.ts.
test.use({ extraHTTPHeaders: visitante('conta') });

/**
 * Exclusao de conta (#39), contra o banco de verdade (#335).
 *
 * A unit de app/conta/seguranca/excluir.test.ts mocka o Supabase inteiro, e o
 * SQL de supabase/tests/exclusao-de-conta.sql prova o banco sozinho. O que so
 * aparece aqui e o caminho todo junto: a acao conferindo a senha, o carimbo de
 * anonimizacao antes do delete, o `on delete set null` e a sessao que morre.
 */

const ITEM: Item = {
  produto_slug: 'camiseta-de-quem-saiu',
  nome: 'Camiseta De Quem Saiu',
  tamanho: 'G',
  quantidade: 1,
  preco_unitario_centavos: 12900,
};

test('conta: excluir com e-mail e senha apaga a conta e deixa o pedido sem dono', async ({
  page,
}) => {
  const u = await criaUsuario('Exclui');
  const pedido = await criaPedido(u, [ITEM], ['pago']);

  try {
    await entra(page, u.email, u.senha);
    await page.goto('/conta/seguranca');

    await (await vivo(page.getByRole('button', { name: 'Quero excluir minha conta' }))).click();
    const excluir = await vivo(page.getByRole('button', { name: 'Excluir minha conta' }));
    // Busca presa ao formulario de exclusao e com nome exato: a mesma tela tem
    // o "Sua senha, para confirmar" da troca de e-mail, e a busca solta do
    // Playwright casa os dois (strict mode).
    const form = page.locator('form.excluir-form');
    const email = form.getByLabel(`Digite ${u.email} para confirmar`, { exact: true });
    const senha = form.getByLabel('Sua senha', { exact: true });
    const aceite = form.getByLabel('Entendi que não dá para desfazer', { exact: true });

    // Senha errada: nada acontece com a conta.
    await email.fill(u.email);
    await senha.fill(senhaNova());
    await aceite.check();
    await excluir.click();
    await expect(
      page.getByRole('alert').filter({ hasText: 'A senha está incorreta.' })
    ).toBeVisible();
    expect(await usuarioExiste(u.id)).toBe(true);

    // Com a senha certa, a conta vai embora e a pessoa cai na home.
    // O aceite de novo: o React pode zerar o formulario quando a acao
    // responde com erro (#130), e a caixa e a ultima trava antes do clique.
    await senha.fill(u.senha);
    await aceite.check();
    await excluir.click();
    await page.waitForURL(
      (url) => url.pathname === '/' && url.searchParams.get('conta') === 'excluida'
    );

    // Lido do banco, e nao da tela.
    expect(await usuarioExiste(u.id)).toBe(false);
    const depois = await leDonoDoPedido(pedido.id);
    expect(depois.user_id).toBeNull();
    expect(depois.anonimizado_em).not.toBeNull();
    expect(depois.total_centavos).toBe(12900);

    // A sessao morreu junto: a conta manda para o login.
    await page.goto('/conta');
    await page.waitForURL(/\/entrar/);

    // E as credenciais antigas nao abrem mais nada.
    await preencheLogin(page, u.email, u.senha);
    await expect(
      page.getByRole('alert').filter({ hasText: 'E-mail ou senha incorretos' })
    ).toBeVisible();
  } finally {
    // Sem dono, o pedido nao sai pela limpeza da suite, que acha pedido pelo
    // dono.
    await apagaPedido(pedido.id);
  }
});
