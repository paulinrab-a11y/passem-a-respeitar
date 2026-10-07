import { type BrowserContext, test as base, expect, type Page, type Route } from '@playwright/test';
import { criaAdmin, criaUsuario, leFreteDoPedido, pedidosDe, type Usuario } from './apoio/banco';
import { CEPS, PORTA_DO_FRETE, TOKEN_DO_FRETE } from './apoio/melhor-envio-falso.mjs';
import { entra, vivo } from './apoio/telas';
import { CEPS_DO_VIACEP } from './apoio/viacep-falso.mjs';
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

/** O botao de envio, pelo tipo: o texto dele muda com o estado do frete, e a
 *  caixa do frete pode ter o de tentar de novo (#240). */
const finalizar = (pagina: Page) => pagina.locator('form.entrega button[type="submit"]');

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
  // A busca do endereco (#204) sai junto com a cotacao e, ao voltar, re-renderiza
  // o formulario — e o React devolve ao radio o `value` original. A adulteracao
  // tem que vir depois dela; o sinal de que voltou e o foco no numero.
  await expect(logada.getByLabel('Número')).toBeFocused();

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

/** O botao da falha passageira (#240), dentro da caixa do frete. */
const tentarDeNovo = (pagina: Page) =>
  pagina.locator('.frete').getByRole('button', { name: 'Tentar de novo' });

// A ultima coluna: se "Tentar de novo" aparece. So para o que passa sozinho —
// CEP que nao existe nao muda com outra consulta (#240).
for (const [caso, cep, frase, oferece] of [
  ['CEP que nao existe', CEPS.inexistente, 'Confira o CEP: não encontrei esse endereço.', false],
  [
    'Melhor Envio fora do ar',
    CEPS.foraDoAr,
    'Não consegui calcular o frete agora. Tente de novo em instantes.',
    true,
  ],
] as const) {
  test(`frete: ${caso} diz o que fazer e nao deixa finalizar`, async ({ logada }) => {
    const antes = await pedidosDe(quem);
    await logada.goto(CHECKOUT);
    await preencheEndereco(logada, cep);

    await expect(logada.locator('.frete').getByRole('alert')).toHaveText(frase);
    await expect(tentarDeNovo(logada)).toHaveCount(oferece ? 1 : 0);
    await expect(logada.getByRole('radio')).toHaveCount(0);
    await expect(finalizar(logada)).toBeDisabled();
    await expect(finalizar(logada)).toContainText('Frete indisponível');
    expect(await pedidosDe(quem)).toBe(antes);
  });
}

test('frete: rede que cai na cotacao vira recado com tentar de novo, e a rede de volta cota', async ({
  logada,
}) => {
  await logada.goto(CHECKOUT);
  await vivo(logada.getByLabel('Quem recebe'));
  await logada.getByLabel('Quem recebe').fill('Fulana da Suíte');

  // Toda server action do checkout e um POST na propria URL. Derrubar o POST
  // e a rede caindo entre a tela e a funcao: a cotacao e a busca do endereco
  // rejeitam no navegador. Antes, isso derrubava o checkout no global-error.
  const semRede = async (rota: Route) => {
    if (rota.request().method() === 'POST') await rota.abort('connectionfailed');
    else await rota.continue();
  };
  await logada.route('**/checkout?**', semRede);
  await logada.getByLabel('CEP').fill('04538133');

  await expect(logada.locator('.frete').getByRole('alert')).toHaveText(
    'Não consegui calcular o frete agora. Tente de novo em instantes.'
  );
  await expect(tentarDeNovo(logada)).toBeVisible();
  await expect(finalizar(logada)).toBeDisabled();
  await expect(finalizar(logada)).toContainText('Frete indisponível');
  // Nada de tela preta, e o que foi digitado fica.
  await expect(logada.getByRole('heading', { name: 'Deu ruim por aqui' })).toHaveCount(0);
  await expect(logada.getByLabel('Quem recebe')).toHaveValue('Fulana da Suíte');
  await expect(logada.getByLabel('CEP')).toHaveValue('04538133');

  await logada.unroute('**/checkout?**', semRede);
  await tentarDeNovo(logada).click();

  await expect(logada.getByRole('radio', { name: /PAC/ })).toBeChecked();
  await expect(finalizar(logada)).toContainText('143,50');
  await expect(finalizar(logada)).toBeEnabled();
});

test('frete: fora do ar, tentar de novo consulta de novo, e redigitar o CEP tambem', async ({
  logada,
}) => {
  const frase = 'Não consegui calcular o frete agora. Tente de novo em instantes.';
  await logada.goto(CHECKOUT);
  await preencheEndereco(logada, CEPS.foraDoAr);
  const alerta = logada.locator('.frete').getByRole('alert');
  await expect(alerta).toHaveText(frase);
  expect(await recebidos()).toHaveLength(1);

  // O clique troca a caixa pelo esqueleto e consulta de novo. O falso
  // continua fora do ar: volta o mesmo recado, e a segunda chamada e a prova.
  await tentarDeNovo(logada).click();
  await expect.poll(async () => (await recebidos()).length).toBe(2);
  await expect(alerta).toHaveText(frase);
  await expect(tentarDeNovo(logada)).toBeVisible();

  // Apagar e redigitar o ultimo digito (#28): antes nao fazia nada.
  await logada.getByLabel('CEP').fill(CEPS.foraDoAr.slice(0, 7));
  await expect(logada.getByText('Digite o CEP para ver o preço do PAC e do SEDEX.')).toBeVisible();
  await logada.getByLabel('CEP').fill(CEPS.foraDoAr);
  await expect.poll(async () => (await recebidos()).length).toBe(3);
  await expect(alerta).toHaveText(frase);
});

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

/**
 * Endereco pelo CEP (#204), contra o ViaCEP falso: qualquer CEP responde a
 * Avenida Paulista, menos os combinados em apoio/viacep-falso.mjs.
 */
test('endereco: o CEP preenche rua, bairro, cidade e UF, e o foco vai para o numero', async ({
  logada,
}) => {
  await logada.goto(CHECKOUT);
  const cep = await vivo(logada.getByLabel('CEP'));
  await cep.click();
  await cep.fill('04538-133');

  await expect(logada.getByLabel('Rua')).toHaveValue('Avenida Paulista');
  await expect(logada.getByLabel('Bairro')).toHaveValue('Bela Vista');
  await expect(logada.getByLabel('Cidade')).toHaveValue('São Paulo');
  await expect(logada.getByLabel('UF')).toHaveValue('SP');
  await expect(logada.getByLabel('Número')).toBeFocused();
  // O que a pessoa escreve a mao continua dela.
  await expect(logada.getByLabel('Quem recebe')).toHaveValue('');
});

test('endereco: CEP desconhecido deixa os campos para a pessoa, sem erro', async ({ logada }) => {
  await logada.goto(CHECKOUT);
  await vivo(logada.getByLabel('Rua'));
  await logada.getByLabel('Rua').fill('Rua Minha');
  await logada.getByLabel('CEP').fill(CEPS_DO_VIACEP.desconhecido);

  // Este CEP tambem e desconhecido para o Melhor Envio falso, e a caixa do
  // frete reclama. Esperar por isso e ter certeza de que a busca do endereco,
  // que sai junto, ja voltou.
  await expect(logada.locator('.frete').getByRole('alert')).toBeVisible();
  await expect(logada.getByLabel('Rua')).toHaveValue('Rua Minha');
  await expect(logada.getByLabel('Cidade')).toHaveValue('');
  await expect(logada.locator('.entrega-campos [role=alert]')).toHaveCount(0);
});

test('endereco: CEP geral traz cidade e UF e nao apaga a rua', async ({ logada }) => {
  await logada.goto(CHECKOUT);
  await vivo(logada.getByLabel('Rua'));
  await logada.getByLabel('Rua').fill('Rua Minha');
  await logada.getByLabel('CEP').fill(CEPS_DO_VIACEP.geral);

  await expect(logada.getByLabel('Cidade')).toHaveValue('Lábrea');
  await expect(logada.getByLabel('UF')).toHaveValue('AM');
  await expect(logada.getByLabel('Rua')).toHaveValue('Rua Minha');
});

test('checkout: o guia de tamanhos esta ao lado do item, com o link para trocar', async ({
  logada,
}) => {
  await logada.goto(CHECKOUT);
  const link = logada.getByRole('button', { name: 'Guia de tamanhos' });
  await vivo(link);
  await link.click();

  const guia = logada.locator('dialog.guia');
  await expect(guia).toBeVisible();
  await expect(guia.locator('tbody tr')).toHaveCount(4);
  await expect(guia.locator('tbody th[scope="row"]').nth(1)).toHaveText('M');

  await guia.getByRole('button', { name: 'fechar' }).click();
  await expect(guia).toBeHidden();
  await expect(logada.getByRole('link', { name: 'Trocar o tamanho' })).toHaveAttribute(
    'href',
    '/#merch'
  );
});
