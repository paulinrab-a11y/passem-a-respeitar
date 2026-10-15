import { expect, test } from '@playwright/test';
import {
  criaAdmin,
  criaPedido,
  criaUsuario,
  type Item,
  leSolicitacoes,
  type Usuario,
} from './apoio/banco';
import { entra, vivo } from './apoio/telas';
import { visitante } from './apoio/visitante';

/**
 * Cancelar pelo site (#379; Decreto 7.962/2013, art. 5º, §§ 1º e 4º).
 *
 * O caminho inteiro, com o banco como juiz: a cliente pede o cancelamento
 * no detalhe do pedido, ve o protocolo na hora, o dono ve a solicitacao no
 * painel e a encerra, e a cliente ve "encerrado".
 */

const ITEM: Item = {
  produto_slug: 'camiseta-do-pos-venda',
  nome: 'Camiseta Do Teste Do Pos Venda',
  tamanho: 'G',
  quantidade: 1,
  preco_unitario_centavos: 12000,
};

const MENSAGEM = 'comprei o tamanho errado';

test.use({ extraHTTPHeaders: visitante('pos-venda') });

// Em serie: o dono encerra o que a cliente pediu no teste anterior.
test.describe.configure({ mode: 'serial' });

let cliente: Usuario;
let admin: Usuario;
let pedido: { id: string; numero: number };
let protocolo: string;

test.beforeAll(async () => {
  cliente = await criaUsuario('Cliente Pos Venda');
  admin = await criaAdmin();
  pedido = await criaPedido(cliente, [ITEM], ['pago']);
});

test('pos-venda: a cliente pede o cancelamento e ve o protocolo na hora', async ({ page }) => {
  await entra(page, cliente.email, cliente.senha);
  await page.goto(`/conta/pedidos/${pedido.id}`);

  const bloco = page.getByRole('region', { name: 'Precisa cancelar, desistir ou trocar?' });
  // Pago: so cancelar. Desistir e depois da entrega.
  await expect(bloco.getByRole('button', { name: 'Quero desistir da compra' })).toHaveCount(0);

  // Dois passos: o primeiro clique so abre a confirmacao.
  await (await vivo(bloco.getByRole('button', { name: 'Pedir cancelamento' }))).click();
  expect(await leSolicitacoes(pedido.id)).toEqual([]);

  await bloco.getByLabel('Quer contar o motivo? (opcional)').fill(MENSAGEM);
  await bloco.getByRole('button', { name: 'Confirmar' }).click();

  const recibo = bloco.getByRole('status').filter({ hasText: 'Recebemos o seu pedido' });
  await expect(recibo).toBeVisible();
  await expect(recibo).toBeFocused();
  protocolo = (await recibo.locator('.pos-venda-protocolo').textContent()) ?? '';
  expect(protocolo).toMatch(/^PV-[0-9A-F]{8}$/);

  // O banco e o juiz: uma linha, da cliente, com a mensagem e o mesmo protocolo.
  const gravadas = await leSolicitacoes(pedido.id);
  expect(gravadas).toEqual([
    {
      tipo: 'cancelamento',
      protocolo,
      mensagem: MENSAGEM,
      user_id: cliente.id,
      resolvida_em: null,
    },
  ]);

  // Recarregada, a tela mostra o protocolo no lugar do botao.
  await page.reload();
  await expect(bloco.getByText(protocolo)).toBeVisible();
  await expect(bloco.getByText(/aguardando a loja/)).toBeVisible();
  await expect(bloco.getByRole('button', { name: 'Pedir cancelamento' })).toHaveCount(0);
  // O e-mail continua como alternativa.
  await expect(bloco.getByRole('link', { name: /@/ })).toBeVisible();
});

test('pos-venda: o dono ve a solicitacao no painel e a encerra', async ({ page }) => {
  await entra(page, admin.email, admin.senha);
  await page.goto('/conta/admin/pedidos');

  const topo = page.getByRole('region', { name: /Pedidos de clientes abertos/ });
  await topo.getByRole('link', { name: new RegExp(protocolo) }).click();
  await page.waitForURL(`**/conta/admin/pedidos/${pedido.id}`);

  const bloco = page.getByRole('region', { name: 'Pedidos do cliente' });
  await expect(bloco.getByText(protocolo)).toBeVisible();
  await expect(bloco.getByText(MENSAGEM)).toBeVisible();

  await (
    await vivo(bloco.getByRole('button', { name: `Marcar ${protocolo} como resolvida` }))
  ).click();
  await expect(bloco.getByText(/encerrado em/)).toBeVisible();

  const [gravada] = await leSolicitacoes(pedido.id);
  expect(gravada.resolvida_em).not.toBeNull();
});

test('pos-venda: a cliente ve o pedido encerrado, e pode pedir de novo', async ({ page }) => {
  await entra(page, cliente.email, cliente.senha);
  await page.goto(`/conta/pedidos/${pedido.id}`);

  const bloco = page.getByRole('region', { name: 'Precisa cancelar, desistir ou trocar?' });
  await expect(bloco.getByText(/encerrado em/)).toBeVisible();
  await expect(bloco.getByRole('button', { name: 'Pedir cancelamento' })).toBeVisible();
});
