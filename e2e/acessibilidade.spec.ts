import {
  type Browser,
  type BrowserContext,
  test as base,
  expect,
  type Page,
} from '@playwright/test';
import { laudo } from './apoio/acessibilidade';
import {
  criaAdmin,
  criaPedido,
  criaUsuario,
  type Endereco,
  type Item,
  senhaNova,
  type Usuario,
} from './apoio/banco';
import { entra, preencheLogin, vivo } from './apoio/telas';
import { visitante } from './apoio/visitante';

/**
 * Acessibilidade, por maquina (#175). WCAG 2.1 A e AA, tela por tela.
 *
 * A regra e zero violacao e zero contraste sem medida. As duas excecoes estao
 * escritas onde acontecem:
 *
 *   - o vermelho da identidade em texto pequeno, contado tela a tela (#176)
 *   - a home, onde o texto fica em cima de uma cena 3D
 */

type Sessao = Awaited<ReturnType<BrowserContext['storageState']>>;
type Pedido = { id: string; numero: number };

const ITEM: Item = {
  produto_slug: 'camiseta-da-leitora',
  nome: 'Camiseta Da Leitora',
  tamanho: 'M',
  quantidade: 1,
  preco_unitario_centavos: 12000,
};

/** O endereco do pedido em andamento: e o que o painel abre e copia (#242). */
const CASA: Endereco = {
  nome: 'Leitora Da Suite',
  cep: '01310100',
  logradouro: 'Rua Da Leitora',
  numero: '5',
  bairro: 'Bela Vista',
  cidade: 'São Paulo',
  uf: 'SP',
};

let pessoa: Usuario;
let emAndamento: Pedido;
let cancelado: Pedido;
let aPagar: Pedido;
let sessao: Sessao;
let sessaoDoAdmin: Sessao;

const test = base.extend<{ logada: Page; administrando: Page }>({
  logada: async ({ browser }, use) => {
    const contexto = await browser.newContext({ storageState: sessao });
    await use(await contexto.newPage());
    await contexto.close();
  },
  administrando: async ({ browser }, use) => {
    const contexto = await browser.newContext({ storageState: sessaoDoAdmin });
    await use(await contexto.newPage());
    await contexto.close();
  },
});

// Cada arquivo e um visitante, com o IP dele: ver apoio/visitante.ts.
test.use({ extraHTTPHeaders: visitante('acessibilidade') });

async function entraEGuarda(browser: Browser, quem: Usuario) {
  const contexto = await browser.newContext();
  await entra(await contexto.newPage(), quem.email, quem.senha);
  const guardada = await contexto.storageState();
  await contexto.close();
  return guardada;
}

/**
 * `vermelho` e quantos textos pequenos na tela usam o vermelho da identidade,
 * que fica em 4,3 para 1 (#176). O numero e exato de proposito: um texto
 * vermelho a mais e uma decisao de desenho, e tem que passar por alguem.
 */
async function confere(page: Page, { vermelho = 0 } = {}) {
  const l = await laudo(page);

  expect(l.violacoes).toEqual([]);
  expect(l.contrasteSemMedida).toEqual([]);
  expect(l.vermelhoDaIdentidade).toHaveLength(vermelho);
}

test.beforeAll(async ({ browser }) => {
  pessoa = await criaUsuario('Leitora');
  // Um pedido em cada tom: andando, parado para sempre, esperando a pessoa.
  emAndamento = await criaPedido(pessoa, [ITEM], ['pago', 'em_producao'], CASA);
  cancelado = await criaPedido(pessoa, [ITEM], ['cancelado']);
  aPagar = await criaPedido(pessoa, [ITEM]);

  sessao = await entraEGuarda(browser, pessoa);
  sessaoDoAdmin = await entraEGuarda(browser, await criaAdmin());
});

const SEM_SESSAO = [
  ['entrar', '/entrar'],
  ['criar conta', '/criar-conta'],
  ['recuperar senha', '/recuperar-senha'],
  ['nova senha, sem link', '/redefinir-senha'],
  ['privacidade', '/privacidade'],
  ['termos de compra', '/termos'],
  ['nao encontrada', '/um-endereco-que-nao-existe'],
] as const;

for (const [nome, caminho] of SEM_SESSAO) {
  test(`acessibilidade: ${nome}`, async ({ page }) => {
    await page.goto(caminho);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    await confere(page);
  });
}

test('acessibilidade: login com erro na tela', async ({ page }) => {
  await page.goto('/entrar');
  await preencheLogin(page, 'ninguem@e2e.test', senhaNova());
  await expect(page.getByRole('alert').filter({ hasText: 'incorretos' })).toBeVisible();

  // A mensagem de erro.
  await confere(page, { vermelho: 1 });
});

test('acessibilidade: cadastro com erro na tela', async ({ page }) => {
  await page.goto('/criar-conta');
  const criar = await vivo(page.getByRole('button', { name: 'Criar conta' }));
  await criar.click();
  // Pelo texto: `alert` sozinho tambem acha o anunciador de rota do Next, que
  // existe desde o primeiro quadro, e a analise comecaria com o botao ainda
  // no meio do envio.
  await expect(page.getByRole('alert').filter({ hasText: 'Confira o e-mail' })).toBeVisible();
  await expect(criar).toBeEnabled();

  // A mensagem de erro.
  await confere(page, { vermelho: 1 });
});

/**
 * Na home o texto fica em cima de uma cena 3D, e nao ha UMA cor de fundo para
 * comparar: o contraste ali e conferido por gente. Violacao, que e o que a
 * maquina sabe afirmar, continua sendo zero.
 */
test('acessibilidade: home', async ({ page }) => {
  test.setTimeout(90_000);

  await page.goto('/');
  await page.locator('#skip').click();
  await page.waitForFunction(() => !document.documentElement.classList.contains('locked'));

  expect((await laudo(page)).violacoes).toEqual([]);
});

test('acessibilidade: home, com a intro na tela', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#skip')).toBeVisible();
  // A analise e do estado modal de verdade, com o fundo ja inerte (#270).
  await expect(page.locator('main')).toHaveAttribute('inert', '');

  expect((await laudo(page)).violacoes).toEqual([]);
});

/**
 * O foco fica dentro de `seletor`? Depois do ultimo item, o Tab sai da pagina
 * para a barra do navegador e o foco fica no <body>; o Tab seguinte volta ao
 * primeiro item. Os dois contam como "dentro".
 */
const focoDentro = (page: Page, seletor: string) =>
  page.evaluate((s) => {
    const ativo = document.activeElement;
    return ativo === document.body || Boolean(document.querySelector(s)?.contains(ativo));
  }, seletor);

/**
 * A abertura prende o foco (#270). `#bar` vem antes de `#intro` no HTML, e o
 * primeiro Tab da home caia nos links da barra, ainda invisiveis, e depois na
 * pagina atras do preto. Ao pular, o foco sumia com a abertura.
 */
test('acessibilidade: home, o Tab fica na abertura e pular leva o foco ao som', async ({
  page,
}) => {
  await page.goto('/');
  // O fundo fica inerte quando a pagina hidrata, antes do script da intro.
  await expect(page.locator('#bar')).toHaveAttribute('inert', '');
  await expect(page.locator('main')).toHaveAttribute('inert', '');

  await page.keyboard.press('Tab');
  await expect(page.locator('#ligar')).toBeFocused();
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('Tab');
    expect(await focoDentro(page, '#intro')).toBe(true);
  }

  await page.locator('#skip').focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !document.documentElement.classList.contains('locked'));

  await expect(page.locator('#som')).toBeFocused();
  await expect(page.locator('[inert]')).toHaveCount(0);
});

/**
 * A loja prende o foco (#270): Tab a partir de Comprar saia do modal para o
 * concierge e para a pagina escondida atras dele. Esc fecha e devolve o foco
 * a quem abriu, com o fundo de volta.
 */
test('acessibilidade: home, o Tab fica na loja aberta e Esc devolve o foco', async ({ page }) => {
  test.setTimeout(90_000);

  await page.goto('/');
  await page.locator('#skip').click();
  await page.waitForFunction(() => !document.documentElement.classList.contains('locked'));

  const comprar = page.locator('#comprar');
  await comprar.scrollIntoViewIfNeeded();
  await comprar.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#loja')).toBeVisible();
  await expect(page.locator('#fecharLoja')).toBeFocused();
  await expect(page.locator('main')).toHaveAttribute('inert', '');

  for (let i = 0; i < 10; i++) {
    await page.keyboard.press('Tab');
    expect(await focoDentro(page, '#loja')).toBe(true);
  }

  await page.keyboard.press('Escape');
  await expect(page.locator('#loja')).toBeHidden();
  await expect(comprar).toBeFocused();
  await expect(page.locator('[inert]')).toHaveCount(0);
});

/**
 * O menu da conta na barra da home, so pelo teclado (#262). O painel sai de
 * #bar por portal; quando ia para o fim do <body>, ficava a umas quinze
 * paradas de Tab do botao que o abria.
 */
test('acessibilidade: home logada, menu da conta pelo teclado', async ({ logada }) => {
  test.setTimeout(90_000);

  await logada.goto('/');
  await logada.locator('#skip').click();
  await logada.waitForFunction(() => !document.documentElement.classList.contains('locked'));

  const gatilho = logada.locator('#bar').getByRole('button', { name: pessoa.nome, exact: true });
  const painel = logada.getByRole('navigation', { name: 'Sua conta' });
  const conta = painel.getByRole('link', { name: 'Conta', exact: true });

  await gatilho.focus();
  await logada.keyboard.press('Enter');
  await expect(conta).toBeFocused();
  await expect(gatilho).toHaveAttribute('aria-expanded', 'true');

  // Com o painel aberto e o foco dentro dele.
  expect((await laudo(logada)).violacoes).toEqual([]);

  // Para tras, o botao; para a frente, o painel, item a item.
  await logada.keyboard.press('Shift+Tab');
  await expect(gatilho).toBeFocused();
  await logada.keyboard.press('Tab');
  await expect(conta).toBeFocused();
  for (const nome of ['Pedidos', 'Segurança']) {
    await logada.keyboard.press('Tab');
    await expect(painel.getByRole('link', { name: nome, exact: true })).toBeFocused();
  }
  await logada.keyboard.press('Tab');
  await expect(painel.getByRole('button', { name: 'Sair', exact: true })).toBeFocused();

  // Depois de Sair vem a pagina, e o painel fecha em vez de ficar por cima.
  await logada.keyboard.press('Tab');
  await expect(painel).toHaveCount(0);
  await expect(gatilho).toHaveAttribute('aria-expanded', 'false');
  expect(
    await logada.evaluate(() => document.querySelector('main')?.contains(document.activeElement))
  ).toBe(true);

  // Escape fecha e devolve o foco ao botao.
  await gatilho.focus();
  await logada.keyboard.press('Enter');
  await expect(conta).toBeFocused();
  await logada.keyboard.press('Escape');
  await expect(painel).toHaveCount(0);
  await expect(gatilho).toBeFocused();
});

const COM_SESSAO = [
  ['conta', () => '/conta', 0],
  ['seguranca', () => '/conta/seguranca', 0],
  // O selo "Aguardando pagamento".
  ['pedidos, um de cada tom', () => '/conta/pedidos', 1],
  ['pedido em andamento', () => `/conta/pedidos/${emAndamento.id}`, 0],
  // A etapa "Cancelado" na linha do tempo.
  ['pedido cancelado', () => `/conta/pedidos/${cancelado.id}`, 1],
  // O selo "Aguardando pagamento".
  ['pedido esperando pagamento', () => `/conta/pedidos/${aPagar.id}`, 1],
  // O selo "Aguardando pagamento".
  ['pagamento', () => `/checkout/pagamento/${aPagar.id}`, 1],
  ['checkout', () => '/checkout?tamanho=M', 0],
] as const;

for (const [nome, caminho, vermelho] of COM_SESSAO) {
  test(`acessibilidade: ${nome}`, async ({ logada }) => {
    await logada.goto(caminho());
    await expect(logada.getByRole('heading', { level: 1 })).toBeVisible();
    // O conteudo chega por streaming: o esqueleto sai antes da analise.
    await expect(logada.locator('.esqueleto')).toHaveCount(0);

    await confere(logada, { vermelho });
  });
}

test('acessibilidade: administracao de pedidos', async ({ administrando }) => {
  await administrando.goto('/conta/admin/pedidos');
  const link = administrando.getByRole('link', {
    name: `Pedido #${emAndamento.numero}`,
    exact: true,
  });
  await expect(link).toBeVisible();

  // Com o endereco aberto e o botao de copiar na tela (#242).
  await administrando.locator('article', { has: link }).locator('summary').click();
  await expect(
    administrando.getByRole('button', {
      name: `Copiar endereço do pedido ${emAndamento.numero}`,
    })
  ).toBeVisible();

  // O filtro padrao e "para enviar": o pedido que espera pagamento nao esta
  // aqui, e com ele saiu o unico texto vermelho da tela.
  await confere(administrando);

  // No filtro dos que esperam, o selo "Aguardando pagamento" do pedido que espera.
  await administrando.goto('/conta/admin/pedidos?status=aguardando_pagamento');
  await expect(
    administrando.getByRole('link', { name: `Pedido #${aPagar.numero}`, exact: true })
  ).toBeVisible();
  await confere(administrando, { vermelho: 1 });
});

test('acessibilidade: a verificacao enxerga defeito quando ha', async ({ page }) => {
  await page.goto('/entrar');
  await page.evaluate(() => {
    const main = document.querySelector('main');
    const botao = document.createElement('button');
    const texto = document.createElement('p');
    texto.textContent = 'Texto que quase nao se le.';
    texto.style.color = '#3a3d42';
    main?.append(botao, texto);
  });

  const regras = (await laudo(page)).violacoes.map((v) => v.regra).sort();

  expect(regras).toEqual(['button-name', 'color-contrast']);
});
