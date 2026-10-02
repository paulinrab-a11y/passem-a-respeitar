import { type BrowserContext, test as base, expect, type Page } from '@playwright/test';
import { criaAdmin, criaUsuario, leFreteDoPedido, pedidosDe, type Usuario } from './apoio/banco';
import { CEPS, PORTA_DO_FRETE, TOKEN_DO_FRETE } from './apoio/melhor-envio-falso.mjs';
import { entra, vivo } from './apoio/telas';
import { visitante } from './apoio/visitante';

/**
 * Frete pelo CEP (#199), de ponta a ponta: o checkout pergunta ao Melhor
 * Envio falso, a pessoa escolhe PAC ou SEDEX, e o pedido grava o que o
 * SERVIDOR cotou.
 *
 * O falso responde PAC a R$ 23,50 em 8 dias e SEDEX a R$ 45,90 em 3, e guarda
 * o que recebeu. Ver apoio/melhor-envio-falso.mjs.
 */

const FALSO = `http://127.0.0.1:${PORTA_DO_FRETE}`;
const CHECKOUT = '/checkout?p=camiseta-cbac&tam=M&q=1';

type Recebido = {
  autorizacao: string | null;
  agente: string | null;
  corpo: {
    from: { postal_code: string };
    to: { postal_code: string };
    products: Record<string, unknown>[];
  };
};

async function recebidos(): Promise<Recebido[]> {
  return (await fetch(`${FALSO}/_recebidos`)).json();
}

async function esqueceRecebidos() {
  await fetch(`${FALSO}/_recebidos`, { method: 'DELETE' });
}

type Sessao = Awaited<ReturnType<BrowserContext['storageState']>>;
let quem: Usuario;
let sessao: Sessao;

/** Um login so para o arquivo: o limite de login e por e-mail. */
const test = base.extend<{ logada: Page }>({
  logada: async ({ browser }, use) => {
    const contexto = await browser.newContext({ storageState: sessao });
    await use(await contexto.newPage());
    await contexto.close();
  },
});

test.use({ extraHTTPHeaders: visitante('frete') });

test.beforeAll(async ({ browser }) => {
  quem = await criaUsuario('Frete');
  const contexto = await browser.newContext({ extraHTTPHeaders: visitante('frete') });
  const pagina = await contexto.newPage();
  await entra(pagina, quem.email, quem.senha);
  sessao = await contexto.storageState();
  await contexto.close();
});

test.beforeEach(esqueceRecebidos);

/** Preenche o endereco inteiro. O CEP vai por ultimo: e ele que dispara a cotacao. */
async function preencheEndereco(pagina: Page, cep: string) {
  await vivo(pagina.getByLabel('Quem recebe'));
  await pagina.getByLabel('Quem recebe').fill('Fulana da Suíte');
  await pagina.getByLabel('Rua').fill('Avenida Paulista');
  await pagina.getByLabel('Número').fill('1578');
  await pagina.getByLabel('Bairro').fill('Bela Vista');
  await pagina.getByLabel('Cidade').fill('São Paulo');
  await pagina.getByLabel('UF').fill('SP');
  await pagina.getByLabel('CEP').fill(cep);
}

/** O botao de envio, pelo papel: o texto dele muda com o estado do frete. */
const finalizar = (pagina: Page) => pagina.locator('form.entrega').getByRole('button');

test('frete: CEP mostra PAC e SEDEX, e o pedido grava o que o servidor cotou', async ({
  logada,
}) => {
  const antes = await pedidosDe(quem);
  await logada.goto(CHECKOUT);
  await expect(logada.getByText('Digite o CEP para ver o preço do PAC e do SEDEX.')).toBeVisible();
  await expect(finalizar(logada)).toBeDisabled();

  await preencheEndereco(logada, '04538-133');

  const pac = logada.getByRole('radio', { name: /PAC/ });
  const sedex = logada.getByRole('radio', { name: /SEDEX/ });
  await expect(pac).toBeChecked();
  await expect(logada.locator('label.frete-opcao', { has: pac })).toContainText('até 8 dias úteis');
  await expect(logada.locator('label.frete-opcao', { has: pac })).toContainText('23,50');
  await expect(logada.locator('label.frete-opcao', { has: sedex })).toContainText(
    'até 3 dias úteis'
  );
  await expect(finalizar(logada)).toContainText('143,50');

  await sedex.check();
  await expect(finalizar(logada)).toContainText('165,90');
  await finalizar(logada).click();

  await logada.waitForURL(/\/checkout\/pagamento\/[0-9a-f-]{36}$/);
  const id = logada.url().split('/').pop() as string;

  // Do banco, e nao da tela.
  expect(await leFreteDoPedido(id)).toEqual({
    total_centavos: 12000 + 4590,
    frete_centavos: 4590,
    frete_servico: 'sedex',
    frete_prazo_dias: 3,
    entrega_cep: '04538133',
  });
  expect(await pedidosDe(quem)).toBe(antes + 1);

  // O que chegou no Melhor Envio: o token, a origem, o destino e as medidas.
  const [primeira] = await recebidos();
  expect(primeira.autorizacao).toBe(`Bearer ${TOKEN_DO_FRETE}`);
  expect(primeira.agente).toMatch(/^Passem a Respeitar \(.+@.+\)$/);
  expect(primeira.corpo.from).toEqual({ postal_code: '01310100' });
  expect(primeira.corpo.to).toEqual({ postal_code: '04538133' });
  expect(primeira.corpo.products).toEqual([
    {
      id: 'camiseta-cbac',
      width: 25,
      height: 4,
      length: 30,
      weight: 0.3,
      insurance_value: 120,
      quantity: 1,
    },
  ]);
});

test('frete: o detalhe do pedido e a lista do administrador mostram o servico', async ({
  logada,
  browser,
}) => {
  await logada.goto(CHECKOUT);
  await preencheEndereco(logada, '04538133');
  await expect(logada.getByRole('radio', { name: /PAC/ })).toBeChecked();
  await finalizar(logada).click();
  await logada.waitForURL(/\/checkout\/pagamento\//);
  const id = logada.url().split('/').pop() as string;

  await logada.goto(`/conta/pedidos/${id}`);
  // Pelo texto: o esqueleto do detalhe tambem tem as duas linhas.
  const frete = logada.locator('.pedido-frete', { hasText: 'Frete · PAC' });
  await expect(frete).toContainText('Frete · PAC, até 8 dias úteis depois da produção');
  await expect(frete).toContainText('23,50');
  await expect(logada.locator('.pedido-total', { hasText: '143,50' })).toBeVisible();

  // O administrador ve qual postagem comprar.
  const dono = await criaAdmin();
  const contexto = await browser.newContext({ extraHTTPHeaders: visitante('frete') });
  const admin = await contexto.newPage();
  await entra(admin, dono.email, dono.senha);
  await admin.goto('/conta/admin/pedidos');
  const pedido = admin.locator('article', { has: admin.locator(`a[href="/conta/pedidos/${id}"]`) });
  await expect(pedido.locator('.pedido-frete')).toContainText('Enviar por PAC');
  await expect(pedido.locator('.pedido-frete')).toContainText('23,50');
  await contexto.close();
});

test('frete: servico adulterado no navegador nao vira pedido', async ({ logada }) => {
  const antes = await pedidosDe(quem);
  await logada.goto(CHECKOUT);
  await preencheEndereco(logada, '04538133');
  await expect(logada.getByRole('radio', { name: /PAC/ })).toBeChecked();

  // O que alguem faria no DevTools: trocar o valor do radio marcado.
  await logada.getByRole('radio', { name: /PAC/ }).evaluate((radio: HTMLInputElement) => {
    radio.value = 'frete-gratis';
  });
  await finalizar(logada).click();

  await expect(
    logada.getByRole('alert').filter({ hasText: 'Escolha PAC ou SEDEX.' })
  ).toBeVisible();
  await expect(logada).toHaveURL(/\/checkout\?/);
  expect(await pedidosDe(quem)).toBe(antes);
});

test('frete: CEP so com PAC mostra so o PAC', async ({ logada }) => {
  await logada.goto(CHECKOUT);
  await preencheEndereco(logada, CEPS.soPac);

  await expect(logada.getByRole('radio', { name: /PAC/ })).toBeChecked();
  await expect(logada.getByRole('radio')).toHaveCount(1);
});

for (const [caso, cep, frase] of [
  ['CEP que nao existe', CEPS.inexistente, 'Confira o CEP: não encontrei esse endereço.'],
  [
    'Melhor Envio fora do ar',
    CEPS.foraDoAr,
    'Não consegui calcular o frete agora. Tente de novo em instantes.',
  ],
] as const) {
  test(`frete: ${caso} diz o que fazer e nao deixa finalizar`, async ({ logada }) => {
    const antes = await pedidosDe(quem);
    await logada.goto(CHECKOUT);
    await preencheEndereco(logada, cep);

    await expect(logada.locator('.frete').getByRole('alert')).toHaveText(frase);
    await expect(logada.getByRole('radio')).toHaveCount(0);
    await expect(finalizar(logada)).toBeDisabled();
    await expect(finalizar(logada)).toContainText('Frete indisponível');
    expect(await pedidosDe(quem)).toBe(antes);
  });
}

test('frete: o botao nao anda quando a cotacao chega', async ({ logada }) => {
  await logada.goto(CHECKOUT);
  await vivo(logada.getByLabel('CEP'));
  await logada.evaluate(() => document.fonts.ready);
  await logada.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)));

  // Na pagina, e nao na tela: preencher o CEP rola a pagina, e a posicao na
  // tela mudaria sem nada ter andado.
  const posicao = () =>
    finalizar(logada).evaluate((b) => b.getBoundingClientRect().top + window.scrollY);
  const parado = await posicao();

  // Segura a resposta da cotacao para medir tambem o esqueleto.
  let solta = () => {};
  const preso = new Promise<void>((resolve) => {
    solta = resolve;
  });
  await logada.route('**/checkout?**', async (rota) => {
    if (rota.request().method() === 'POST') await preso;
    await rota.continue();
  });

  await logada.getByLabel('CEP').fill('04538133');
  await expect(logada.locator('.frete-esqueleto')).toHaveCount(2);
  const esperando = await posicao();

  solta();
  await expect(logada.getByRole('radio')).toHaveCount(2);
  const cotado = await posicao();

  expect(esperando).toBe(parado);
  expect(cotado).toBe(parado);
});
