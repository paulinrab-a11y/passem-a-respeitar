import { readFileSync } from 'node:fs';
import { type BrowserContext, test as base, expect, type Page } from '@playwright/test';
import {
  criaAdmin,
  criaPedido,
  criaUsuario,
  type Endereco,
  type Item,
  lePedido,
  leRastreioDoPedido,
  type Usuario,
} from './apoio/banco';
import { entra, vivo } from './apoio/telas';
import { visitante } from './apoio/visitante';

/**
 * Tela administrativa de pedidos (#43) e a mudanca de status (#157).
 *
 * E a unica tela do site que ve pedido alheio. O primeiro teste e o que
 * importa mais: quem nao administra nao sabe nem que ela existe.
 */

const ITEM: Item = {
  produto_slug: 'camiseta-do-admin',
  nome: 'Camiseta Do Teste Do Admin',
  tamanho: 'M',
  quantidade: 1,
  preco_unitario_centavos: 12000,
};

const MOTIVO = 'separado pela suite';

/** O endereco do pedido da suite: rua que nao existe em pedido nenhum. */
const ENDERECO: Endereco = {
  nome: 'Destinataria Do Teste Do Admin',
  cep: '01310100',
  logradouro: 'Rua Que So O Admin Ve',
  numero: '77',
  complemento: 'fundos',
  bairro: 'Bela Vista',
  cidade: 'São Paulo',
  uf: 'SP',
};

/**
 * Um a mais do que cabe numa pagina (POR_PAGINA = 20, em lib/conta/pedidos.ts).
 * Antes da #242, 21 abandonos de Pix bastavam para empurrar um pedido pago
 * para fora dos 50 mais recentes.
 */
const PENDENTES = 21;

type Sessao = Awaited<ReturnType<BrowserContext['storageState']>>;

let sessaoDoAdmin: Sessao;

/**
 * O administrador entra uma vez, no `beforeAll`, e os testes do painel
 * reaproveitam a sessao: o login tem limite de cinco tentativas por e-mail.
 */
const test = base.extend<{ administrando: Page }>({
  administrando: async ({ browser }, use) => {
    const contexto = await browser.newContext({ storageState: sessaoDoAdmin });
    await use(await contexto.newPage());
    await contexto.close();
  },
});

// Cada arquivo e um visitante, com o IP dele: ver apoio/visitante.ts.
test.use({ extraHTTPHeaders: visitante('admin') });

let admin: Usuario;
let cliente: Usuario;
let pedido: { id: string; numero: number };

// Em serie: o ultimo teste le o que o penultimo gravou. Se um falha, os
// seguintes sao pulados, em vez de rodarem contra um pedido recriado.
test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ browser }) => {
  admin = await criaAdmin();
  cliente = await criaUsuario('Cliente');
  pedido = await criaPedido(cliente, [ITEM], ['pago'], ENDERECO);

  const contexto = await browser.newContext();
  await entra(await contexto.newPage(), admin.email, admin.senha);
  sessaoDoAdmin = await contexto.storageState();
  await contexto.close();
});

/** O card do pedido da suite, no meio dos outros. */
const card = (page: Page) =>
  page.locator('article', {
    has: page.getByRole('link', { name: `Pedido #${pedido.numero}`, exact: true }),
  });

test('admin: quem nao administra recebe 404, e nenhum pedido', async ({ page }) => {
  await entra(page, cliente.email, cliente.senha);

  const resposta = await page.goto('/conta/admin/pedidos');

  expect(resposta?.status()).toBe(404);
  expect(await resposta?.text()).not.toContain(`Pedido #${pedido.numero}`);
  await expect(page.getByRole('link', { name: 'Administrar pedidos' })).toHaveCount(0);
});

test('admin: sem sessao, a tela manda para o login', async ({ page }) => {
  await page.goto('/conta/admin/pedidos');

  await expect(page).toHaveURL(/\/entrar/);
});

test('admin: mudar o status grava no banco, com autor e motivo, e o card sinaliza', async ({
  page,
}) => {
  await entra(page, admin.email, admin.senha);
  await page.goto('/conta/admin/pedidos');

  const selo = card(page).locator('.pedido-status');
  await expect(selo).toHaveText('Pago');
  // Na carga da pagina nada anima (#157).
  await expect(selo).toHaveClass('pedido-status normal');
  await expect(card(page).locator('.admin-botoes')).toHaveClass('admin-botoes');
  // O botao diz o que faz com o dinheiro (#22), antes de qualquer clique.
  await expect(card(page).locator('.admin-nota')).toContainText(
    'Reembolsar estorna o pagamento no Mercado Pago'
  );

  // Tudo que o selo e os botoes fizerem daqui em diante fica anotado.
  await card(page).evaluate((el) => {
    const w = window as unknown as { __selo: string[]; __lugares: string[] };
    w.__selo = [];
    w.__lugares = [];
    const anota = () => {
      const s = el.querySelector('.pedido-status');
      if (s) w.__selo.push(`${s.className} | ${s.textContent}`);
      // O lugar que o elemento OCUPA, e nao a caixa desenhada: `transform`
      // desenha fora do lugar sem empurrar ninguem, e e so com ele que as
      // entradas se mexem. A soma vai ate o topo do documento porque a
      // referencia de `offsetTop` muda enquanto a pagina termina de entrar.
      const topo = (alvo: Element | null) => {
        let y = 0;
        for (let e = alvo as HTMLElement | null; e; e = e.offsetParent as HTMLElement | null) {
          y += e.offsetTop;
        }
        return y;
      };
      w.__lugares.push(`card ${topo(el)} | botoes ${topo(el.querySelector('.admin-botoes'))}`);
    };
    new MutationObserver(anota).observe(el, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class'],
    });
  });
  const lugarAntes = await card(page).evaluate((el) => {
    const topo = (alvo: Element | null) => {
      let y = 0;
      for (let e = alvo as HTMLElement | null; e; e = e.offsetParent as HTMLElement | null) {
        y += e.offsetTop;
      }
      return y;
    };
    return `card ${topo(el)} | botoes ${topo(el.querySelector('.admin-botoes'))}`;
  });

  const separar = await vivo(card(page).getByRole('button', { name: 'Pôr em produção' }));
  await card(page).getByLabel('Motivo (opcional)').fill(MOTIVO);
  await separar.click();

  await expect(selo).toHaveText('Em produção');
  await expect(
    card(page).getByRole('alert').filter({ hasText: 'Status atualizado' })
  ).toBeVisible();
  // Os botoes agora sao os da etapa seguinte, e o motivo nao vale para ela.
  await expect(card(page).getByRole('button', { name: 'Marcar enviado' })).toBeVisible();
  await expect(card(page).getByRole('button', { name: 'Pôr em produção' })).toHaveCount(0);
  await expect(card(page).getByLabel('Motivo (opcional)')).toHaveValue('');

  // O selo antigo saiu antes de o novo entrar, e o novo entrou animado.
  const passos = await page.evaluate(() => (window as unknown as { __selo: string[] }).__selo);
  const semRepetir = passos.filter((p, i) => p !== passos[i - 1]);
  expect(semRepetir).toContain('pedido-status normal saindo | Pago');
  expect(semRepetir.at(-1)).toBe('pedido-status normal trocou | Em produção');
  expect(semRepetir.indexOf('pedido-status normal saindo | Pago')).toBeLessThan(
    semRepetir.indexOf('pedido-status normal trocou | Em produção')
  );
  await expect(card(page).locator('.admin-botoes')).toHaveClass('admin-botoes entrou');

  // Nem o card nem os botoes saíram do lugar, em nenhum momento: os da etapa
  // nova entraram onde os antigos estavam.
  const lugares = await page.evaluate(
    () => (window as unknown as { __lugares: string[] }).__lugares
  );
  expect(lugares.length).toBeGreaterThan(0);
  expect([...new Set(lugares)]).toEqual([lugarAntes]);

  // O que vale e o banco: status novo, e a trilha dizendo quem, de onde e por que.
  const gravado = await lePedido(pedido.id);
  expect(gravado.status).toBe('em_producao');
  expect(gravado.trilha.at(-1)).toMatchObject({
    de: 'pago',
    para: 'em_producao',
    autor: admin.id,
    motivo: MOTIVO,
  });
});

test('admin: o dono do pedido ve a mudanca na tela dele', async ({ page }) => {
  await entra(page, cliente.email, cliente.senha);
  await page.goto(`/conta/pedidos/${pedido.id}`);

  await expect(page.locator('.detalhe-topo .pedido-status')).toHaveText('Em produção');
  // O motivo e nota interna: fica no banco, nao na tela do cliente.
  expect(await page.content()).not.toContain(MOTIVO);
});

/**
 * O endereco e o painel com filtro (#242). Em serie com os de cima: o pedido
 * da suite ja esta em producao, que continua dentro do filtro padrao.
 */
const filtros = (page: Page) => page.getByRole('navigation', { name: 'Filtrar por status' });

test('admin: o endereco abre no card, e copiar leva a etiqueta inteira', async ({
  administrando,
}) => {
  await administrando.goto('/conta/admin/pedidos');

  const corpo = card(administrando).locator('.admin-entrega-corpo');
  const rua = corpo.getByText('Rua Que So O Admin Ve, 77, fundos');
  // Fechado por padrao: nome e cidade ja estao no card; o resto so quando se pede.
  await expect(rua).toBeHidden();

  await card(administrando).locator('summary', { hasText: 'Endereço de entrega' }).click();
  await expect(rua).toBeVisible();
  await expect(corpo.getByText('Bela Vista — São Paulo/SP')).toBeVisible();
  await expect(corpo.getByText('CEP 01310-100')).toBeVisible();

  await administrando.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  const copiar = await vivo(
    corpo.getByRole('button', { name: `Copiar endereço do pedido ${pedido.numero}` })
  );
  await copiar.click();

  await expect(corpo.getByRole('status')).toHaveText('Endereço copiado.');
  // O que foi para a area de transferencia e a etiqueta, linha a linha. No
  // Windows a area de transferencia devolve as quebras como CRLF; o que se
  // confere e o conteudo de cada linha, nao o fim dela.
  const colado = await administrando.evaluate(() => navigator.clipboard.readText());
  expect(colado.split(/\r?\n/)).toEqual([
    ENDERECO.nome,
    'Rua Que So O Admin Ve, 77, fundos',
    'Bela Vista — São Paulo/SP',
    'CEP 01310-100',
  ]);
});

test('admin: o filtro padrao mostra o pedido a enviar mesmo com 21 pendentes mais novos', async ({
  administrando,
}) => {
  // 21 abandonos de Pix depois do pedido pago, como no cenario do achado #17.
  let maisNovo = pedido;
  for (let i = 0; i < PENDENTES; i++) maisNovo = await criaPedido(cliente, [ITEM]);

  await administrando.goto('/conta/admin/pedidos');

  await expect(
    administrando.getByRole('link', { name: `Pedido #${pedido.numero}`, exact: true })
  ).toBeVisible();
  await expect(
    administrando.getByRole('link', { name: `Pedido #${maisNovo.numero}`, exact: true })
  ).toHaveCount(0);
  await expect(filtros(administrando).getByRole('link', { name: /^Para enviar/ })).toHaveAttribute(
    'aria-current',
    'page'
  );

  // O contador vem do banco inteiro: conta pelo menos os 21 criados agora.
  const pendentes = await filtros(administrando)
    .getByRole('link', { name: /^Aguardando pagamento/ })
    .locator('.admin-filtro-n')
    .textContent();
  expect(Number(pendentes)).toBeGreaterThanOrEqual(PENDENTES);
});

test('admin: cada filtro pagina, e a pagina guarda o filtro', async ({ administrando }) => {
  await administrando.goto('/conta/admin/pedidos?status=aguardando_pagamento');

  await expect(administrando.locator('.pedidos > li')).toHaveCount(20);
  await expect(
    administrando.getByRole('link', { name: `Pedido #${pedido.numero}`, exact: true })
  ).toHaveCount(0);

  await administrando.getByRole('link', { name: 'Mais antigos →' }).click();
  await administrando.waitForURL('**/conta/admin/pedidos?status=aguardando_pagamento&p=2');
  await expect(administrando.locator('.pedidos > li').first()).toBeVisible();
  await expect(administrando.getByText('Página 2')).toBeVisible();
  await expect(administrando.getByRole('link', { name: '← Mais recentes' })).toHaveAttribute(
    'href',
    '/conta/admin/pedidos?status=aguardando_pagamento'
  );
});

test('admin: filtro e pagina invalidos caem no padrao; pagina vazia volta para a primeira', async ({
  administrando,
}) => {
  await administrando.goto('/conta/admin/pedidos?status=extraviado&p=abc');
  await expect(filtros(administrando).getByRole('link', { name: /^Para enviar/ })).toHaveAttribute(
    'aria-current',
    'page'
  );
  await expect(
    administrando.getByRole('link', { name: `Pedido #${pedido.numero}`, exact: true })
  ).toBeVisible();

  await administrando.goto('/conta/admin/pedidos?status=todos&p=999');
  await administrando.waitForURL(
    (url) =>
      url.pathname === '/conta/admin/pedidos' &&
      url.searchParams.get('status') === 'todos' &&
      !url.searchParams.has('p')
  );
  await expect(filtros(administrando).getByRole('link', { name: /^Todos/ })).toHaveAttribute(
    'aria-current',
    'page'
  );
});

/**
 * O detalhe do dono e a planilha (#345). O card levava a /conta/pedidos/{id},
 * a tela do cliente, que filtra por `user_id` e dava 404 para o dono.
 */
test('admin: o card diz o que separar e leva ao detalhe do dono', async ({ administrando }) => {
  await administrando.goto('/conta/admin/pedidos');

  await expect(card(administrando).locator('.admin-itens')).toHaveText(
    `1× ${ITEM.nome} · ${ITEM.tamanho}`
  );

  await card(administrando)
    .getByRole('link', { name: `Pedido #${pedido.numero}`, exact: true })
    .click();
  await administrando.waitForURL(`**/conta/admin/pedidos/${pedido.id}`);

  await expect(administrando.getByRole('heading', { level: 1 })).toHaveText(
    `Pedido #${pedido.numero}`
  );
  // O e-mail de quem comprou, que o card nao mostra.
  await expect(
    administrando.getByRole('link', { name: new RegExp(`^${cliente.email}$`, 'i') })
  ).toBeVisible();
  // A trilha com quem mudou e o motivo — nota interna que o cliente nao ve.
  await expect(
    administrando.getByText(new RegExp(`por ${admin.email} · ${MOTIVO}`, 'i'))
  ).toBeVisible();
  await expect(administrando.getByText('Rua Que So O Admin Ve, 77, fundos')).toBeVisible();
  await expect(administrando.getByText('Nenhuma tentativa ainda.')).toBeVisible();
});

test('admin: o detalhe do dono e a planilha sao 404 para o cliente, ate do pedido dele', async ({
  page,
}) => {
  await entra(page, cliente.email, cliente.senha);

  const detalhe = await page.goto(`/conta/admin/pedidos/${pedido.id}`);
  expect(detalhe?.status()).toBe(404);
  expect(await detalhe?.text()).not.toContain(MOTIVO);

  const planilha = await page.request.get('/api/admin/pedidos');
  expect(planilha.status()).toBe(404);
});

test('admin: exportar baixa a planilha do filtro aberto', async ({ administrando }) => {
  await administrando.goto('/conta/admin/pedidos');

  const [arquivo] = await Promise.all([
    administrando.waitForEvent('download'),
    administrando.getByRole('link', { name: 'Exportar CSV' }).click(),
  ]);

  expect(arquivo.suggestedFilename()).toMatch(/^pedidos-\d{4}-\d{2}-\d{2}\.csv$/);
  const texto = readFileSync(await arquivo.path(), 'utf8');
  expect(texto).toContain(`"${pedido.numero}"`);
  expect(texto).toContain('Rua Que So O Admin Ve, 77, fundos');
  expect(texto).toContain('"Em produção"');
});

/**
 * Marcar enviado exige o codigo dos Correios (#378). Por ultimo de proposito:
 * os testes de cima contam com o pedido da suite em producao, dentro do
 * filtro padrao.
 */
test('admin: marcar enviado pede o codigo de rastreio e grava junto com o status', async ({
  administrando,
}) => {
  await administrando.goto(`/conta/admin/pedidos/${pedido.id}`);

  const enviar = await vivo(administrando.getByRole('button', { name: 'Marcar enviado' }));
  const codigo = administrando.getByLabel('Código de rastreio (para marcar enviado)');

  // Sem o codigo, o navegador segura o envio: nada muda no banco.
  await enviar.click();
  await expect(codigo).toBeFocused();
  expect((await lePedido(pedido.id)).status).toBe('em_producao');

  // Minusculo e com espaco, como se digita: o servidor normaliza.
  await codigo.fill('ab 123456789 br');
  await enviar.click();

  await expect(administrando.locator('.detalhe-topo .pedido-status')).toHaveText('Enviado');
  await expect(
    administrando.getByRole('alert').filter({ hasText: 'Status atualizado' })
  ).toBeVisible();
  // O detalhe do dono mostra o codigo que o cliente vai ver.
  await expect(administrando.locator('.rastreio-codigo')).toHaveText('AB123456789BR');

  expect(await leRastreioDoPedido(pedido.id)).toEqual({
    rastreio_codigo: 'AB123456789BR',
    rastreio_url: null,
  });
  const gravado = await lePedido(pedido.id);
  expect(gravado.status).toBe('enviado');
  expect(gravado.trilha.at(-1)).toMatchObject({
    de: 'em_producao',
    para: 'enviado',
    autor: admin.id,
  });
});

test('admin: o cliente ve o codigo de rastreio, com copiar e o link dos Correios', async ({
  page,
}) => {
  await entra(page, cliente.email, cliente.senha);
  await page.goto(`/conta/pedidos/${pedido.id}`);

  const bloco = page.getByRole('region', { name: 'Rastreio' });
  await expect(bloco.locator('code')).toHaveText('AB123456789BR');
  await expect(bloco.getByRole('link', { name: /Rastrear nos Correios/ })).toHaveAttribute(
    'href',
    'https://rastreamento.correios.com.br/app/index.php'
  );

  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await (await vivo(bloco.getByRole('button', { name: 'Copiar código' }))).click();
  await expect(bloco.getByRole('status')).toHaveText('Código copiado.');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('AB123456789BR');
});
