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
  emAndamento = await criaPedido(pessoa, [ITEM], ['pago', 'em_producao']);
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
  await page.getByLabel('Como quer ser chamado').fill('Leitora');
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

  expect((await laudo(page)).violacoes).toEqual([]);
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
  await expect(
    administrando.getByRole('link', { name: `Pedido #${emAndamento.numero}`, exact: true })
  ).toBeVisible();

  // O selo "Aguardando pagamento" do pedido que espera.
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
