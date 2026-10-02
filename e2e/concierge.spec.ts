import { expect, type Page, test } from '@playwright/test';
import { laudo } from './apoio/acessibilidade';
import { visitante } from './apoio/visitante';

// Cada arquivo e um visitante, com o IP dele: ver apoio/visitante.ts.
test.use({ extraHTTPHeaders: visitante('concierge') });

/**
 * O Concierge da home (#191), de ponta a ponta.
 *
 * A rota e respondida aqui mesmo, pelo teste: a suite nao fala com o Gemini,
 * e o que se prova nao e a resposta dele. E que o painel abre e fecha do
 * jeito certo, que a pergunta sai com o formato que a rota espera, que a
 * resposta vira bolha, e que tudo isso passa pelo axe com o painel aberto.
 *
 * A rota em si tem teste de unidade, com o `fetch` do Gemini falso.
 */

const RESPOSTA = 'Sai dia 20 de novembro, nas plataformas.';

/** Assinatura de mentira: a rota e falsa, entao ninguem confere. */
const ASSINATURA = `v1.9999999999.${'0'.repeat(64)}`;

type Pedido = { mensagem: string; historico: unknown[]; website?: string };

/** Responde pela rota e guarda o que o navegador mandou. */
async function rotaFalsa(page: Page) {
  const pedidos: Pedido[] = [];
  await page.route('**/api/concierge', async (rota) => {
    pedidos.push(rota.request().postDataJSON() as Pedido);
    await rota.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'cache-control': 'no-store' },
      body: JSON.stringify({ ok: true, resposta: RESPOSTA, voz: ASSINATURA }),
    });
  });
  return pedidos;
}

/** Um WAV de 0,2 s de silencio, mono, 16 bits, 8 kHz: o que a voz falsa toca. */
function wavDeSilencio() {
  const taxa = 8000;
  const amostras = Math.round(taxa * 0.2);
  const dados = amostras * 2;
  const wav = Buffer.alloc(44 + dados);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + dados, 4);
  wav.write('WAVE', 8);
  wav.write('fmt ', 12);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(taxa, 24);
  wav.writeUInt32LE(taxa * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(dados, 40);
  return wav;
}

/** Responde pela rota da voz (#193) e guarda o que o navegador mandou. */
async function vozFalsa(page: Page) {
  const pedidos: { texto: string; assinatura: string }[] = [];
  await page.route('**/api/concierge/voz', async (rota) => {
    pedidos.push(rota.request().postDataJSON());
    await rota.fulfill({ status: 200, contentType: 'audio/wav', body: wavDeSilencio() });
  });
  return pedidos;
}

/** A home sem a intro, com o script da home ja no ar. */
async function homeAberta(page: Page) {
  await page.goto('/');
  await page.locator('#skip').click();
  await page.waitForFunction(() => !document.documentElement.classList.contains('locked'));
}

test('concierge: abre, pergunta, le a resposta e fecha pelo teclado', async ({ page }) => {
  // A cena 3D roda por software no navegador sem tela.
  test.setTimeout(90_000);

  const pedidos = await rotaFalsa(page);
  await homeAberta(page);

  const abrir = page.getByRole('button', { name: 'concierge' });
  const painel = page.getByRole('dialog', { name: 'Concierge' });

  await expect(painel).toBeHidden();
  await abrir.click();
  await expect(painel).toBeVisible();
  await expect(abrir).toHaveAttribute('aria-expanded', 'true');

  // A primeira bolha e a abertura, antes de qualquer pergunta.
  const bolhas = painel.locator('.concierge-bolha');
  await expect(bolhas).toHaveCount(1);

  const campo = page.getByLabel('Pergunta para o concierge');
  await expect(campo).toBeFocused();
  await campo.fill('quando sai?');
  await campo.press('Enter');

  await expect(bolhas.filter({ hasText: RESPOSTA })).toBeVisible();
  await expect(bolhas).toHaveCount(3);

  // O que saiu: a pergunta, sem historico (era a primeira), isca vazia.
  expect(pedidos).toHaveLength(1);
  expect(pedidos[0]?.mensagem).toBe('quando sai?');
  expect(pedidos[0]?.historico).toEqual([]);
  expect(pedidos[0]?.website ?? '').toBe('');

  // Voz (#193): o botao pede o audio com o texto e a assinatura da resposta,
  // toca, e volta a "ouvir" quando acaba.
  const vozes = await vozFalsa(page);
  const ouvir = bolhas.filter({ hasText: RESPOSTA }).getByRole('button', { name: 'Ouvir' });
  await ouvir.click();
  await expect.poll(() => vozes.length).toBe(1);
  expect(vozes[0]).toEqual({ texto: RESPOSTA, assinatura: ASSINATURA });
  await expect(ouvir).toHaveText('ouvir', { timeout: 5000 });
  await expect(ouvir).toHaveAttribute('aria-pressed', 'false');

  // A segunda pergunta leva a primeira troca junto.
  await campo.fill('e a camiseta?');
  await page.getByRole('button', { name: 'enviar' }).click();
  await expect(bolhas).toHaveCount(5);
  expect(pedidos[1]?.historico).toEqual([
    { papel: 'usuario', texto: 'quando sai?' },
    { papel: 'concierge', texto: RESPOSTA },
  ]);

  // Esc fecha, e o foco volta para o botao que abriu.
  await page.keyboard.press('Escape');
  await expect(painel).toBeHidden();
  await expect(abrir).toHaveAttribute('aria-expanded', 'false');
  await expect(abrir).toBeFocused();
});

test('concierge: erro da rota vira aviso, nao bolha', async ({ page }) => {
  test.setTimeout(90_000);

  await page.route('**/api/concierge', (rota) =>
    rota.fulfill({
      status: 429,
      contentType: 'application/json',
      body: JSON.stringify({ ok: false, erro: 'Muitas perguntas de uma vez.' }),
    })
  );
  await homeAberta(page);

  await page.getByRole('button', { name: 'concierge' }).click();
  const campo = page.getByLabel('Pergunta para o concierge');
  await campo.fill('oi');
  await campo.press('Enter');

  const aviso = page.locator('#conciergeAviso');
  await expect(aviso).toHaveText('Muitas perguntas de uma vez. Espera um pouco e tenta de novo.');
  // A pergunta da pessoa fica; resposta nao ha.
  await expect(page.locator('.concierge-bolha')).toHaveCount(2);
  await expect(campo).toBeEditable();
});

test('acessibilidade: home, com o concierge aberto', async ({ page }) => {
  test.setTimeout(90_000);

  await rotaFalsa(page);
  await homeAberta(page);
  await page.getByRole('button', { name: 'concierge' }).click();

  const campo = page.getByLabel('Pergunta para o concierge');
  await campo.fill('quando sai?');
  await campo.press('Enter');
  await expect(page.locator('.concierge-bolha').filter({ hasText: RESPOSTA })).toBeVisible();

  expect((await laudo(page)).violacoes).toEqual([]);
});
