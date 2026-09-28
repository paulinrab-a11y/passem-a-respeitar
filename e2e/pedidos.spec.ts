import { type BrowserContext, test as base, expect, type Page } from '@playwright/test';
import { criaPedido, criaUsuario, type Item, type Usuario } from './apoio/banco';
import { entra } from './apoio/telas';

/**
 * Pedidos (#41, #42) e o caso negativo da #10: o pedido do vizinho.
 *
 * Os itens de cada usuario tem nomes que nao se repetem no outro. Assim
 * "nao aparece nada do vizinho" vira uma busca por texto na resposta inteira,
 * e nao so no que a tela resolveu desenhar.
 */

const DA_ANA: Item = {
  produto_slug: 'camiseta-da-ana',
  nome: 'Camiseta Que So A Ana Comprou',
  tamanho: 'M',
  quantidade: 2,
  preco_unitario_centavos: 12000,
};

const DO_BETO: Item = {
  produto_slug: 'moletom-do-beto',
  nome: 'Moletom Que So O Beto Comprou',
  tamanho: 'G',
  quantidade: 1,
  preco_unitario_centavos: 34567,
};

/** Um id com formato certo que nao e de pedido nenhum. */
const DE_NINGUEM = '00000000-0000-4000-8000-000000000000';

const NAO_ACHEI = 'This page could not be found';

type Pedido = { id: string; numero: number };
type Sessao = Awaited<ReturnType<BrowserContext['storageState']>>;

let ana: Usuario;
let beto: Usuario;
let daAna: Pedido;
let doBeto: Pedido;
let sessaoDaAna: Sessao;

/**
 * A Ana entra uma vez, e os testes reaproveitam a sessao.
 *
 * O login tem limite de cinco tentativas por e-mail. Um login por teste
 * encostaria no limite, e a primeira repeticao no CI passaria dele.
 */
const test = base.extend<{ comoAna: Page }>({
  comoAna: async ({ browser }, use) => {
    const contexto = await browser.newContext({ storageState: sessaoDaAna });
    await use(await contexto.newPage());
    await contexto.close();
  },
});

test.beforeAll(async ({ browser }) => {
  ana = await criaUsuario('Ana');
  beto = await criaUsuario('Beto');
  daAna = await criaPedido(ana, [DA_ANA], ['pago']);
  doBeto = await criaPedido(beto, [DO_BETO], ['pago']);

  const contexto = await browser.newContext();
  await entra(await contexto.newPage(), ana.email, ana.senha);
  sessaoDaAna = await contexto.storageState();
  await contexto.close();
});

test('pedidos: a lista mostra os pedidos de quem entrou, e so eles', async ({ comoAna }) => {
  const resposta = await comoAna.goto('/conta/pedidos');

  await expect(comoAna.getByRole('link', { name: `Pedido #${daAna.numero}` })).toBeVisible();
  await expect(comoAna.getByText(DA_ANA.nome)).toBeVisible();
  await expect(comoAna.getByText(/R\$\s*240,00/).first()).toBeVisible();

  await expect(comoAna.getByRole('link', { name: `Pedido #${doBeto.numero}` })).toHaveCount(0);
  // Controle: o corpo da resposta e onde os dados chegam. Se o nome da Ana
  // nao estivesse nele, procurar o do Beto ali nao provaria nada.
  const corpo = (await resposta?.text()) ?? '';
  expect(corpo).toContain(DA_ANA.nome);
  expect(corpo).not.toContain(DO_BETO.nome);
  expect(await comoAna.content()).not.toContain(DO_BETO.nome);
});

test('pedidos: o detalhe abre pelo link da lista', async ({ comoAna }) => {
  await comoAna.goto('/conta/pedidos');
  await comoAna.getByRole('link', { name: `Pedido #${daAna.numero}` }).click();
  await comoAna.waitForURL(`**/conta/pedidos/${daAna.id}`);

  await expect(comoAna.getByRole('heading', { name: `Pedido #${daAna.numero}` })).toBeVisible();
  await expect(comoAna.getByText(DA_ANA.nome)).toBeVisible();
  await expect(comoAna.getByRole('heading', { name: 'Andamento' })).toBeVisible();
  // Pedido pago nao oferece pagar de novo (#113).
  await expect(comoAna.getByRole('link', { name: 'Pagar agora' })).toHaveCount(0);
});

test('pedidos: o pedido do vizinho e um pedido que nao existe', async ({ comoAna }) => {
  const doVizinho = await comoAna.goto(`/conta/pedidos/${doBeto.id}`);
  await expect(comoAna.getByText(NAO_ACHEI)).toBeVisible();

  // Nada do Beto chega ao navegador da Ana: nem desenhado, nem escondido no
  // HTML, nem nos dados que o React recebe por streaming.
  const corpo = (await doVizinho?.text()) ?? '';
  const tela = await comoAna.content();
  for (const texto of [corpo, tela]) {
    expect(texto).not.toContain(DO_BETO.nome);
    expect(texto).not.toContain(`Pedido #${doBeto.numero}`);
    expect(texto).not.toContain(beto.email);
    expect(texto).not.toContain('345,67');
  }
  await expect(comoAna.getByRole('heading', { name: 'Andamento' })).toHaveCount(0);

  // E a resposta e a MESMA de um pedido inexistente, status incluido: qualquer
  // diferenca entre as duas diria "este existe, so nao e seu".
  const inexistente = await comoAna.goto(`/conta/pedidos/${DE_NINGUEM}`);
  await expect(comoAna.getByText(NAO_ACHEI)).toBeVisible();
  expect(doVizinho?.status()).toBe(inexistente?.status());
});

test('pedidos: id que nao e id responde 404', async ({ comoAna }) => {
  const resposta = await comoAna.goto('/conta/pedidos/nao-sou-um-id');
  expect(resposta?.status()).toBe(404);
});

test('pedidos: a tela de pagamento do pedido do vizinho tambem nao abre', async ({ comoAna }) => {
  const resposta = await comoAna.goto(`/checkout/pagamento/${doBeto.id}`);
  const corpo = (await resposta?.text()) ?? '';

  expect(corpo).not.toContain(DO_BETO.nome);
  expect(corpo).not.toContain('345,67');
  await expect(comoAna.getByRole('button', { name: /Pagar/ })).toHaveCount(0);
});

test('pedidos: sem sessao, nem a lista nem o detalhe respondem', async ({ page }) => {
  await page.goto('/conta/pedidos');
  await expect(page).toHaveURL(/\/entrar/);

  await page.goto(`/conta/pedidos/${daAna.id}`);
  await expect(page).toHaveURL(/\/entrar/);
  expect(await page.content()).not.toContain(DA_ANA.nome);
});
