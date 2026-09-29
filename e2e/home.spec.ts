import { expect, test } from '@playwright/test';
import { visitante } from './apoio/visitante';

// Cada arquivo e um visitante, com o IP dele: ver apoio/visitante.ts.
test.use({ extraHTTPHeaders: visitante('home') });

/**
 * A home, no build de producao.
 *
 * Nao e teste de animacao: nenhum teste automatico pega regressao de
 * animacao, e quem confere isso e gente olhando. O que se pega aqui e o que
 * quebra em silencio — a politica de seguranca barrando um script do proprio
 * site, ou um erro de JavaScript que so existe fora do modo de
 * desenvolvimento.
 */
test('home: abre sem erro de script e sem violar a politica de seguranca', async ({ page }) => {
  const erros: string[] = [];
  const barrados: string[] = [];

  page.on('pageerror', (e) => erros.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && /Content Security Policy/i.test(m.text())) barrados.push(m.text());
  });

  const resposta = await page.goto('/');
  expect(resposta?.status()).toBe(200);
  await expect(page).toHaveTitle(/Passem a Respeitar/i);

  // Tempo para o script da home subir e pedir o que pede.
  await page.waitForLoadState('load');
  await page.waitForTimeout(1500);

  expect(barrados).toEqual([]);
  expect(erros).toEqual([]);
});

test('home: os cabecalhos de seguranca saem no build de producao', async ({ request }) => {
  const resposta = await request.get('/');
  const cabecalhos = resposta.headers();

  const csp = cabecalhos['content-security-policy'] ?? '';
  expect(csp).toContain("default-src 'self'");
  expect(csp).toMatch(/script-src [^;]*'nonce-/);
  // Os dois que a #16 proibe em script-src.
  const scriptSrc = /script-src ([^;]*)/.exec(csp)?.[1] ?? '';
  expect(scriptSrc).not.toContain("'unsafe-inline'");
  expect(scriptSrc).not.toContain("'unsafe-eval'");

  expect(cabecalhos['x-frame-options']).toBe('DENY');
  expect(cabecalhos['x-content-type-options']).toBe('nosniff');
  expect(cabecalhos['strict-transport-security']).toContain('max-age=31536000');
  expect(cabecalhos['x-powered-by']).toBeUndefined();
});

test('home: os elementos cromados baixam em WebP, sem recorrer ao PNG', async ({ page }) => {
  // A cena 3D roda por software no navegador sem tela, e rolar por ela e lento.
  test.setTimeout(90_000);

  const pedidos: { caminho: string; status: number; tipo: string }[] = [];
  page.on('response', (resposta) => {
    const { pathname } = new URL(resposta.url());
    if (!pathname.startsWith('/elementos/')) return;
    pedidos.push({
      caminho: pathname,
      status: resposta.status(),
      tipo: resposta.headers()['content-type'] ?? '',
    });
  });

  await page.goto('/');
  await page.locator('#skip').click();
  await page.waitForFunction(() => !document.documentElement.classList.contains('locked'));

  // Cada elemento baixa quando o elo dele chega perto (#47): e preciso passar
  // por eles.
  // Os cinco elementos moram nos cinco primeiros elos.
  for (let i = 1; i <= 5; i++) {
    await page.locator(`#elo-${i}`).scrollIntoViewIfNeeded();
    await page.waitForTimeout(250);
  }

  await expect.poll(() => pedidos.length).toBeGreaterThanOrEqual(5);
  // Folga para um PNG de reserva aparecer, se fosse aparecer: ele so e pedido
  // quando o navegador nao consegue abrir o WebP.
  await page.waitForTimeout(1000);

  expect(pedidos.map((p) => p.caminho).sort()).toEqual([
    '/elementos/corrente.webp',
    '/elementos/mao.webp',
    '/elementos/p.webp',
    '/elementos/pistola.webp',
    '/elementos/saturno.webp',
  ]);
  for (const pedido of pedidos) {
    expect(pedido.status, pedido.caminho).toBe(200);
    expect(pedido.tipo, pedido.caminho).toBe('image/webp');
  }
});

/**
 * Os nomes (#187): o selo e Whynot Visuals, e a camiseta e so da CBAC.
 *
 * O nome e a descricao da camiseta vem do banco, e o link do selo e escrito
 * pelo script da home: os dois so existem com o site de pe.
 */
test('home: o selo e Whynot Visuals, e a camiseta e so da CBAC', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('#merch .nome')).toHaveText('Camiseta CBAC');
  await expect(page.locator('#merch')).not.toContainText('Passem a Respeitar');
  await expect(page.locator('#merch')).not.toContainText('Edição do EP');

  const selo = page.locator('footer.assina #igLabel');
  await expect(selo).toHaveText('Whynot Visuals');
  await expect(selo).toHaveAttribute('href', 'https://instagram.com/whynotvisuals_');
  await expect(page.locator('footer.assina span')).toHaveText('CBAC');

  // "P.A.R." sozinho continua no texto: e o nome do EP. O que saiu foi a colab.
  await expect(page.locator('body')).not.toContainText(/WhyNot Records|CBAC x/i);
});

// 320 e a tela mais estreita que o site atende; 390 e a do telefone do dono.
for (const largura of [320, 390]) {
  test(`home: em ${largura}px a fita da intro nao encosta no pular`, async ({ page }) => {
    await page.setViewportSize({ width: largura, height: 780 });
    await page.goto('/');
    await page.evaluate(() => document.fonts.ready);

    const fita = page.locator('#tape');
    await expect(fita).toHaveText('SP · 2026 · WHYNOT VISUALS');

    const medida = await page.evaluate(() => {
      const caixa = (id: string) => document.querySelector(id)?.getBoundingClientRect();
      const a = caixa('#tape');
      const b = caixa('#skip');
      if (!a || !b) return null;
      return { fimDaFita: a.right, comecoDoPular: b.left, linhas: a.height };
    });

    expect(medida).not.toBeNull();
    // Doze pixels de respiro: menos que isso os dois textos viram um so.
    expect((medida?.comecoDoPular ?? 0) - (medida?.fimDaFita ?? 0)).toBeGreaterThanOrEqual(12);
    // Uma linha so: a fita que quebra sobe por cima do botao de som.
    expect(medida?.linhas).toBeLessThan(24);
  });
}
