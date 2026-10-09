import { test as base, expect, type Locator, type Page } from '@playwright/test';
import {
  criaPedido,
  criaUsuario,
  envelhecePagamentos,
  type Item,
  lePagamentos,
  lePedido,
  type Usuario,
} from './apoio/banco';
import { poeBrickFalso } from './apoio/brick-falso';
import {
  CARTOES,
  copiaECola,
  PORTA_DO_MP,
  QR_DO_PIX,
  TOKEN_DO_MP,
} from './apoio/mercadopago-falso.mjs';
import { entra } from './apoio/telas';
import { visitante } from './apoio/visitante';

/**
 * A tela de pagamento de ponta a ponta (#274): o formulario entrega o que a
 * pessoa escolheu, a rota de cobranca cria a ordem no Mercado Pago falso, e a
 * tela conta o que aconteceu — pago, recusado, em analise, Pix esperando.
 *
 * O formulario e um falso no lugar do Payment Brick (ver apoio/brick-falso.ts):
 * o de verdade e iframe do Mercado Pago, e nao carrega sem rede nem chave de
 * verdade. O falso so troca o que esta DENTRO do iframe; o que a nossa tela
 * faz com a resposta, e o caminho inteiro do servidor, sao os de producao.
 *
 * O Mercado Pago falso decide o cartao pelo comeco do token e guarda o que
 * recebeu. Ver apoio/mercadopago-falso.mjs.
 */

const FALSO = `http://127.0.0.1:${PORTA_DO_MP}`;

// Os dois relogios da tela, copiados e nao importados: os componentes puxam a
// acao do servidor e o Supabase junto, e o teste nao precisa disso. Se
// mudarem la, o teste falha esperando a pagina trocar.
//
// `CONFERE_A_CADA_MS`, de Pix.tsx: de quanto em quanto a tela do Pix confere.
const CONFERE_A_CADA_MS = 10_000;
// `ESPERA_ANALISE_MS`, de Brick.tsx: quanto o aviso de analise fica na tela.
const ESPERA_ANALISE_MS = 3_000;

const CAMISETA: Item = {
  produto_slug: 'camiseta-cbac',
  nome: 'Camiseta CBAC',
  tamanho: 'M',
  quantidade: 1,
  preco_unitario_centavos: 12000,
};

const RECUSADO = 'O pagamento não foi aprovado. Você pode tentar de novo.';

type Recebido = {
  metodo: string;
  caminho: string;
  autorizacao: string | null;
  idempotencia: string | null;
  corpo: Record<string, unknown> | null;
};

async function recebidos(): Promise<Recebido[]> {
  return (await fetch(`${FALSO}/_recebidos`)).json();
}

async function esqueceRecebidos() {
  await fetch(`${FALSO}/_recebidos`, { method: 'DELETE' });
}

/** As criacoes de ordem que chegaram ao falso, na ordem em que chegaram. */
async function criacoes() {
  return (await recebidos()).filter((r) => r.metodo === 'POST' && r.caminho === '/v1/orders');
}

/** A pessoa pagou o Pix no app do banco. Devolve o id da ordem paga. */
async function pagaNoBanco(pedido: string): Promise<string> {
  const r = await fetch(`${FALSO}/_paga?referencia=${pedido}`, { method: 'POST' });
  expect(r.status, 'havia um Pix esperando no Mercado Pago falso').toBe(200);
  return ((await r.json()) as { id: string }).id;
}

type Cena = {
  pagina: Page;
  quem: Usuario;
  pedido: { id: string; numero: number };
  brick: Awaited<ReturnType<typeof poeBrickFalso>>;
};

/**
 * Uma pessoa nova por teste, com um pedido esperando pagamento.
 *
 * Nova de proposito: a rota de cobranca aceita cinco tentativas por hora por
 * pessoa, e este arquivo cobra mais que isso.
 */
const test = base.extend<{ cena: Cena }>({
  cena: async ({ page }, use) => {
    const quem = await criaUsuario('Pagante');
    const pedido = await criaPedido(quem, [CAMISETA]);
    const brick = await poeBrickFalso(page);
    await entra(page, quem.email, quem.senha);

    await use({ pagina: page, quem, pedido, brick });

    // Nada saiu do navegador para o Mercado Pago, em nenhum teste daqui.
    expect(brick.paraOMercadoPago).toEqual([]);
  },
});

test.use({ extraHTTPHeaders: visitante('pagamento') });
test.beforeEach(esqueceRecebidos);

/** Abre a tela e devolve o formulario, ja montado e com o esqueleto fora. */
async function abrePagamento({ pagina, pedido }: Cena): Promise<Locator> {
  await pagina.goto(`/checkout/pagamento/${pedido.id}`);
  const form = pagina.getByRole('form', { name: 'Formulário do Mercado Pago' });
  await expect(form).toBeVisible();
  // A tela ouviu o `onReady`: o esqueleto cedeu o lugar.
  await expect(pagina.locator('.brick-pilha')).toHaveAttribute('data-pronto', '');
  return form;
}

async function pagaComCartao(form: Locator, cartao: string) {
  await form.getByLabel('Cartão', { exact: true }).check();
  await form.getByLabel('Cartão de teste').selectOption(cartao);
  await form.getByRole('button', { name: 'Pagar' }).click();
}

async function pagaComPix(form: Locator) {
  await form.getByLabel('Pix').check();
  await form.getByRole('button', { name: 'Pagar' }).click();
}

const selo = (pagina: Page) => pagina.locator('.detalhe-topo .pedido-status');

test('pagamento: cartao aprovado vira pedido pago, com o valor do banco', async ({ cena }) => {
  const { pagina, pedido, quem } = cena;
  const form = await abrePagamento(cena);

  await pagaComCartao(form, CARTOES.aprovado);

  // Aprovado: quem conta a historia e o pedido.
  await pagina.waitForURL(`**/conta/pedidos/${pedido.id}`);
  await expect(selo(pagina)).toHaveText('Pago');
  expect((await lePedido(pedido.id)).status).toBe('pago');

  const [tentativa, ...outras] = await lePagamentos(pedido.id);
  expect(outras).toEqual([]);
  expect(tentativa).toMatchObject({
    tentativa: 1,
    metodo: 'credit_card',
    estado: 'aprovado',
    valor_centavos: 12000,
    provedor_status: 'processed',
    provedor_status_detail: 'accredited',
  });

  // O que chegou ao Mercado Pago: o valor do BANCO (o formulario mandou
  // R$ 0,01 e a tela jogou fora), a chave da linha, a referencia do pedido.
  const [criacao, ...mais] = await criacoes();
  expect(mais).toEqual([]);
  expect(criacao.autorizacao).toBe(`Bearer ${TOKEN_DO_MP}`);
  expect(criacao.idempotencia).toBe(tentativa.idempotency_key);
  expect(criacao.corpo).toMatchObject({
    total_amount: '120.00',
    external_reference: pedido.id,
    payer: { email: quem.email, identification: { type: 'CPF', number: '12345678909' } },
    transactions: {
      payments: [
        {
          amount: '120.00',
          payment_method: { id: 'master', type: 'credit_card', installments: 1 },
        },
      ],
    },
  });
  expect(JSON.stringify(criacao.corpo)).not.toContain('0.01');
});

test('pagamento: cartao recusado mantem o formulario com aviso, e cabe outra tentativa', async ({
  cena,
}) => {
  const { pagina, pedido } = cena;
  const form = await abrePagamento(cena);
  await form.getByLabel('Nome no cartão').fill('Fulana da Suíte');

  await pagaComCartao(form, CARTOES.recusado);

  await expect(pagina.locator('.brick').getByRole('alert')).toHaveText(RECUSADO);
  // O formulario ficou — o MESMO, com o que a pessoa digitou —, e o botao
  // voltou. Recriar o formulario apagaria o cartao meio digitado.
  await expect(form.getByRole('button', { name: 'Pagar' })).toBeEnabled();
  await expect(form.getByLabel('Nome no cartão')).toHaveValue('Fulana da Suíte');
  expect(await cena.brick.contagem()).toEqual({ criados: 1, desmontados: 0 });
  await expect(pagina).toHaveURL(new RegExp(`/checkout/pagamento/${pedido.id}$`));

  // Recusa nao mexe no pedido: ele segue esperando, e a tentativa guarda o
  // porque.
  expect((await lePedido(pedido.id)).status).toBe('aguardando_pagamento');
  expect(await lePagamentos(pedido.id)).toMatchObject([
    {
      tentativa: 1,
      estado: 'recusado',
      provedor_status: 'failed',
      provedor_status_detail: 'rejected_by_issuer',
    },
  ]);

  // Outro cartao, no mesmo formulario.
  await pagaComCartao(form, CARTOES.aprovado);
  await pagina.waitForURL(`**/conta/pedidos/${pedido.id}`);
  await expect(selo(pagina)).toHaveText('Pago');

  const tentativas = await lePagamentos(pedido.id);
  expect(tentativas.map((t) => [t.tentativa, t.estado])).toEqual([
    [1, 'recusado'],
    [2, 'aprovado'],
  ]);
  // Cada tentativa com a sua chave: reusar a da recusada devolveria a recusa.
  expect((await criacoes()).map((c) => c.idempotencia)).toEqual(
    tentativas.map((t) => t.idempotency_key)
  );
});

test('pagamento: cartao em analise mostra o aviso e depois abre o pedido', async ({ cena }) => {
  const { pagina, pedido } = cena;
  await pagina.clock.install();
  const form = await abrePagamento(cena);

  await pagaComCartao(form, CARTOES.emAnalise);

  // A tela diz que o cartao nao foi aprovado nem recusado, ANTES de ir ao
  // pedido. O formulario sai: a cobranca ja existe la (#20).
  const aviso = pagina.getByRole('status').filter({ hasText: 'Pagamento em análise' });
  await expect(aviso).toContainText('O cartão ainda não foi aprovado nem recusado');
  await expect(form).toHaveCount(0);
  await expect(aviso.getByRole('link', { name: 'Ver pedido' })).toHaveAttribute(
    'href',
    `/conta/pedidos/${pedido.id}`
  );

  expect(await lePagamentos(pedido.id)).toMatchObject([
    {
      estado: 'pendente',
      provedor_status: 'processing',
      provedor_status_detail: 'in_review',
    },
  ]);
  expect((await lePedido(pedido.id)).status).toBe('aguardando_pagamento');

  // Passado o tempo de ler, a tela vai ao pedido sozinha.
  await pagina.clock.fastForward(ESPERA_ANALISE_MS);
  await pagina.waitForURL(`**/conta/pedidos/${pedido.id}`);
  await expect(selo(pagina)).toHaveText('Aguardando pagamento');
});

/** Gera o Pix pela tela e devolve o id da ordem que o Mercado Pago falso criou. */
async function geraPix(cena: Cena): Promise<string> {
  const { pagina, pedido } = cena;
  const form = await abrePagamento(cena);

  await pagaComPix(form);

  const codigo = pagina.getByLabel('Pix copia e cola');
  await expect(codigo).toBeVisible();
  await expect(form).toHaveCount(0);

  const [tentativa] = await lePagamentos(pedido.id);
  expect(tentativa).toMatchObject({
    metodo: 'pix',
    estado: 'pendente',
    provedor_status: 'action_required',
    provedor_status_detail: 'waiting_transfer',
  });
  const ordem = String(tentativa.provedor_pagamento_id);

  // O QR e o copia-e-cola sao os que o provedor mandou, nunca montados aqui.
  await expect(codigo).toHaveValue(copiaECola(ordem));
  await expect(pagina.getByRole('img', { name: /QR Code do Pix/ })).toHaveAttribute(
    'src',
    `data:image/png;base64,${QR_DO_PIX}`
  );
  await expect(pagina.locator('.pix-valor')).toHaveText(/R\$\s*120,00/);
  await expect(pagina.locator('.pix-espera .pedido-status')).toHaveText('Aguardando pagamento');

  const [criacao] = await criacoes();
  expect(criacao.corpo).toMatchObject({
    total_amount: '120.00',
    transactions: { payments: [{ payment_method: { id: 'pix', type: 'bank_transfer' } }] },
  });

  return ordem;
}

test('pagamento: Pix pendente vira pago quando o Mercado Pago avisa, e a tela abre o pedido', async ({
  cena,
  request,
}) => {
  const { pagina, pedido } = cena;
  await pagina.clock.install();
  const ordem = await geraPix(cena);

  // A pessoa paga no app do banco, e o Mercado Pago avisa o site. Ordem de
  // teste vem sem assinatura que se possa conferir: o site confirma
  // perguntando ao provedor (lib/loja/webhook.ts).
  expect(await pagaNoBanco(pedido.id)).toBe(ordem);
  const aviso = await request.post(`/api/mercado-pago/webhook?data.id=${ordem}&type=order`, {
    data: { type: 'order', action: 'order.processed', data: { id: ordem } },
  });
  expect(aviso.status()).toBe(200);
  expect((await lePedido(pedido.id)).status).toBe('pago');

  // Nada empurra isso para a aba aberta: ela descobre na proxima conferencia.
  await expect(pagina).toHaveURL(new RegExp(`/checkout/pagamento/${pedido.id}$`));
  await pagina.clock.fastForward(CONFERE_A_CADA_MS);

  await pagina.waitForURL(`**/conta/pedidos/${pedido.id}`);
  await expect(selo(pagina)).toHaveText('Pago');
});

test('pagamento: Pix pago sem aviso do Mercado Pago e achado pela conferencia da tela', async ({
  cena,
}) => {
  const { pagina, pedido } = cena;
  await pagina.clock.install();
  const ordem = await geraPix(cena);

  // Pagou, e o webhook se perdeu. A conferencia da tela pergunta ao provedor
  // por tentativa com mais de 15 s; o relogio do servidor e o de verdade.
  await pagaNoBanco(pedido.id);
  await envelhecePagamentos(pedido.id, 60_000);
  expect((await lePedido(pedido.id)).status).toBe('aguardando_pagamento');

  await pagina.clock.fastForward(CONFERE_A_CADA_MS);

  await pagina.waitForURL(`**/conta/pedidos/${pedido.id}`);
  await expect(selo(pagina)).toHaveText('Pago');
  expect(await lePagamentos(pedido.id)).toMatchObject([
    { estado: 'aprovado', provedor_status: 'processed' },
  ]);
  // Quem achou foi a consulta ao Mercado Pago falso.
  expect(
    (await recebidos()).some((r) => r.metodo === 'GET' && r.caminho === `/v1/orders/${ordem}`)
  ).toBe(true);
});

test('pagamento: a rota cobra o valor do banco, e responde so o estado', async ({ cena }) => {
  const { pagina, pedido } = cena;

  // Direto na rota, como um formulario adulterado faria: valor em todo campo
  // que alguem imaginaria que o servidor leia.
  const r = await pagina.request.post('/api/checkout/pagamento', {
    data: {
      pedido: pedido.id,
      payment_method_id: 'master',
      token: `${CARTOES.aprovado}0123456789`,
      installments: 1,
      amount: 1,
      transaction_amount: 1,
      total_amount: '1.00',
      total_centavos: 100,
    },
  });

  expect(r.status()).toBe(200);
  expect(await r.json()).toEqual({ estado: 'aprovado' });

  const [criacao] = await criacoes();
  expect(criacao.corpo).toMatchObject({
    total_amount: '120.00',
    transactions: { payments: [{ amount: '120.00' }] },
  });
  expect((await lePedido(pedido.id)).status).toBe('pago');
});

test('pagamento: cartao sem limite volta 2xx do provedor e continua sendo recusa', async ({
  cena,
}) => {
  const { pagina, pedido } = cena;

  const r = await pagina.request.post('/api/checkout/pagamento', {
    data: {
      pedido: pedido.id,
      payment_method_id: 'visa',
      token: `${CARTOES.semLimite}0123456789`,
      installments: 1,
    },
  });

  // 2xx do provedor nao e aprovacao (#20): para quem paga, e recusa.
  expect(r.status()).toBe(402);
  expect(await r.json()).toEqual({ erro: RECUSADO });
  expect((await lePedido(pedido.id)).status).toBe('aguardando_pagamento');
  expect(await lePagamentos(pedido.id)).toMatchObject([
    {
      estado: 'recusado',
      provedor_status: 'failed',
      provedor_status_detail: 'insufficient_amount',
    },
  ]);
});

test('pagamento: o pedido do vizinho nao abre nem cobra', async ({ cena }) => {
  const { pagina } = cena;
  const vizinho = await criaUsuario('Vizinho');
  const doVizinho = await criaPedido(vizinho, [CAMISETA]);

  const tela = await pagina.goto(`/checkout/pagamento/${doVizinho.id}`);
  expect(tela?.status()).toBe(404);
  await expect(pagina.getByRole('form', { name: 'Formulário do Mercado Pago' })).toHaveCount(0);

  // Nem pela rota: "nao e seu" e "nao existe" sao a mesma resposta.
  const r = await pagina.request.post('/api/checkout/pagamento', {
    data: { pedido: doVizinho.id, payment_method_id: 'pix' },
  });
  expect(r.status()).toBe(404);
  expect(await r.json()).toEqual({ erro: 'Pedido não encontrado.' });

  expect(await recebidos()).toEqual([]);
  expect(await lePagamentos(doVizinho.id)).toEqual([]);
  expect((await lePedido(doVizinho.id)).status).toBe('aguardando_pagamento');
});
