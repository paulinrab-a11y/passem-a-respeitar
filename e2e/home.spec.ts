import { expect, type Page, test } from '@playwright/test';
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

  // Credito do site (#195).
  const credito = page.locator('footer.assina .assina-credito');
  await expect(credito).toHaveText('site feito pela Whynot Visuals');
  await expect(credito.getByRole('link', { name: 'Whynot Visuals' })).toHaveAttribute(
    'href',
    'https://instagram.com/whynotvisuals_'
  );

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

/**
 * Frete na ficha (#205), contra o Melhor Envio falso da suite: qualquer CEP
 * responde PAC a 23,50 e SEDEX a 45,90.
 */
test('home: a ficha da camiseta mostra o frete pelo CEP, sem login', async ({ page }) => {
  await page.goto('/');
  await page.locator('#skip').click();
  await page.waitForFunction(() => !document.documentElement.classList.contains('locked'));

  const campo = page.locator('#merch').getByLabel('Frete para o seu CEP');
  await campo.scrollIntoViewIfNeeded();
  await vivoHome(campo);
  await campo.fill('04538-133');

  const resposta = page.locator('#merch .frete-ficha-resposta');
  // O Melhor Envio falso responde na hora; o que demora e esta maquina, que roda
  // o site e o navegador juntos. Vinte segundos e folga, nao expectativa.
  await expect(resposta).toContainText('SEDEX', { timeout: 20_000 });
  await expect(resposta).toContainText('45,90');
  await expect(resposta).toContainText('até 3 dias úteis depois da produção');

  // O mesmo CEP aparece na loja, sem digitar de novo.
  await page.locator('#comprar').click();
  await expect(page.locator('#loja').getByLabel('Frete para o seu CEP')).toHaveValue('04538-133');
  await expect(page.locator('#loja .frete-ficha-resposta')).toContainText('45,90', {
    timeout: 20_000,
  });

  // E fica no navegador, para o checkout.
  expect(await page.evaluate(() => localStorage.getItem('par_cep'))).toBe('04538133');
});

test('home: a ficha nao anda quando o frete chega', async ({ page }) => {
  // No telefone a galeria vem DEBAIXO da ficha: e ela que andaria se a linha
  // do frete nao tivesse lugar reservado. No computador sao duas colunas.
  await page.setViewportSize({ width: 390, height: 780 });
  await page.goto('/');
  await page.locator('#skip').click();
  await page.waitForFunction(() => !document.documentElement.classList.contains('locked'));
  const campo = page.locator('#merch').getByLabel('Frete para o seu CEP');
  await campo.scrollIntoViewIfNeeded();
  await vivoHome(campo);
  // Sem esperar animacao: a home tem laco e animacao cancelada pelo scroll,
  // e a espera nunca acabaria. As duas medidas sao tiradas no mesmo estado,
  // depois de a fonte carregar; o que muda entre elas e so o frete chegar.
  await page.evaluate(() => document.fonts.ready);

  const galeria = page.locator('#galeriaMerch');
  const posicao = () => galeria.evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
  const antes = await posicao();

  await campo.fill('04538133');
  await expect(page.locator('#merch .frete-ficha-resposta')).toContainText('45,90', {
    timeout: 20_000,
  });

  expect(await posicao()).toBe(antes);
});

/** Espera o componente da ficha hidratar, como o `vivo` de apoio/telas. */
async function vivoHome(alvo: import('@playwright/test').Locator) {
  await expect(alvo).toBeVisible();
  await expect
    .poll(() => alvo.evaluate((el) => Object.keys(el).some((k) => k.startsWith('__reactProps'))))
    .toBe(true);
}

/**
 * Guia de tamanhos (#206): abre num <dialog>, fecha por botao, Esc e clique
 * fora, e o foco volta ao link. Na loja, Esc fecha o guia e NAO a loja.
 */
test('home: o guia de tamanhos abre na ficha, prende o foco e devolve ao fechar', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('#skip').click();
  await page.waitForFunction(() => !document.documentElement.classList.contains('locked'));

  const link = page.locator('#merch').getByRole('button', { name: 'Guia de tamanhos' });
  await link.scrollIntoViewIfNeeded();
  await vivoHome(link);
  await link.click();

  const guia = page.locator('#merch dialog.guia');
  await expect(guia).toBeVisible();
  await expect(guia.getByRole('heading', { name: 'Guia de tamanhos' })).toBeVisible();
  await expect(guia.locator('tbody tr')).toHaveCount(4);
  await expect(guia.locator('tbody tr').first()).toContainText('P');
  await expect(guia.locator('tbody tr').last()).toContainText('GG');
  // Foco preso: Tab anda so dentro do modal.
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement?.closest('dialog.guia') !== null)).toBe(
    true
  );

  await page.keyboard.press('Escape');
  await expect(guia).toBeHidden();
  await expect(link).toBeFocused();
});

test('home: na loja, Esc fecha o guia e deixa a loja aberta', async ({ page }) => {
  await page.goto('/');
  await page.locator('#skip').click();
  await page.waitForFunction(() => !document.documentElement.classList.contains('locked'));
  await page.locator('#comprar').scrollIntoViewIfNeeded();
  await page.locator('#comprar').click();
  await expect(page.locator('#loja')).toBeVisible();

  const link = page.locator('#loja').getByRole('button', { name: 'Guia de tamanhos' });
  await vivoHome(link);
  await link.click();
  const guia = page.locator('#loja dialog.guia');
  await expect(guia).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(guia).toBeHidden();
  await expect(page.locator('#loja')).toBeVisible();

  // Clique fora da caixa tambem fecha. O fundo e o ::backdrop do dialog, que
  // nao e um elemento: o clique vai pela posicao, no canto da tela.
  await link.click();
  await expect(guia).toBeVisible();
  await page.mouse.click(5, 5);
  await expect(guia).toBeHidden();
});

/**
 * Sem WebGL (#238): o navegador que nao oferece contexto 3D nao pode ficar
 * preso na abertura. O WebGL e negado antes de qualquer script da pagina, e o
 * que se mede e o que sobra: a intro fecha pelo pular, a trava cai, a barra
 * aparece, o canvas sai, os elos sao legiveis e a loja abre em fotos. Nenhum
 * erro de script. Nao depende de GPU: e o caminho que roda SEM ela.
 */
test('home: sem WebGL a abertura fecha e a pagina segue em HTML', async ({ page }) => {
  const erros: string[] = [];
  page.on('pageerror', (e) => erros.push(e.message));

  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      tipo: string,
      ...resto: unknown[]
    ) {
      if (/webgl/i.test(tipo)) return null;
      return Reflect.apply(original, this, [tipo, ...resto]);
    } as typeof original;
  });

  await page.goto('/');
  // O script chegou, tentou a cena, marcou a raiz e seguiu.
  await expect(page.locator('html')).toHaveClass(/\bsem-webgl\b/);
  await expect(page.locator('#gl')).toBeHidden();

  await page.locator('#skip').click();
  await page.waitForFunction(() => !document.documentElement.classList.contains('locked'));
  await expect(page.locator('#intro')).toBeHidden();
  await expect(page.locator('#bar')).toHaveClass(/\bon\b/);

  // Os elos aparecem sem a camera que os revelaria.
  await expect(page.locator('#elo-3 .box')).toHaveCSS('opacity', '1');

  // E a loja abre, em fotos: sem WebGL nao ha vitrine 3D (#217).
  await page.locator('#comprar').scrollIntoViewIfNeeded();
  await page.locator('#comprar').click();
  await expect(page.locator('#loja')).toBeVisible();
  await expect(page.locator('#vitrine')).toHaveClass(/\bmodo-360\b/);

  expect(erros).toEqual([]);
});

/**
 * Atalhos e indicador "tocando" (#280). N pula o beat em qualquer lugar da
 * pagina — menos onde a pessoa digita: no concierge, cada "n" de uma frase
 * trocava a faixa. E o indicador e um botao, alcancavel pelo teclado, so
 * enquanto aparece.
 */
test('home: N pula o beat fora dos campos, nao enquanto a pessoa digita', async ({ page }) => {
  // A cena 3D roda por software no navegador sem tela.
  test.setTimeout(90_000);
  // O que se mede e a troca de faixa, nao o audio. Com o play() de verdade, a
  // promessa dele resolve quando o beat carrega e sobe o volume por cima do
  // fade de saida de um N apertado antes disso: a troca se perde e o teste
  // dependeria da velocidade da maquina.
  await page.addInitScript(() => {
    HTMLMediaElement.prototype.play = () => new Promise<void>(() => {});
  });

  await page.goto('/');
  await page.locator('#skip').click();
  await page.waitForFunction(() => !document.documentElement.classList.contains('locked'));

  const pill = page.locator('#tocando');
  const nome = page.locator('#tocandoNome');
  const pular = page.getByRole('button', { name: /pular para o próximo beat/ });

  // Som desligado: o indicador e transparente, e fica fora do Tab e do leitor.
  await expect(pill).toHaveAttribute('tabindex', '-1');
  await expect(pular).toHaveCount(0);

  await page.locator('#som').click();
  await expect(pill).toHaveClass(/\bon\b/);
  await expect(nome).not.toHaveText('');
  // Aceso, e um botao com nome: o beat que toca e o que ele faz.
  await expect(pular).toHaveId('tocando');
  await expect(pill).not.toHaveAttribute('tabindex', '-1');
  const primeiro = (await nome.textContent()) ?? '';

  const abrir = page.getByRole('button', { name: 'concierge' });
  await abrir.click();
  const campo = page.locator('#conciergeTexto');
  await expect(campo).toBeFocused();
  await campo.pressSequentially('não, N novo');
  // O fade da troca e de 400 ms: folga para uma troca que nao devia vir.
  await page.waitForTimeout(1000);
  await expect(campo).toHaveValue('não, N novo');
  await expect(nome).toHaveText(primeiro);

  // Fora do campo, o atalho volta a valer.
  await page.keyboard.press('Escape');
  await expect(abrir).toBeFocused();
  await page.keyboard.press('n');
  await expect(nome).not.toHaveText(primeiro);
  const segundo = (await nome.textContent()) ?? '';

  // E o indicador pula pelo teclado, como pelo clique.
  await pill.focus();
  await page.keyboard.press('Enter');
  await expect(nome).not.toHaveText(segundo);
});

/**
 * "Reduzir movimento" na cena 3D (#286). Nenhum teste automatico pega
 * regressao de animacao (AGENTS.md); o que se mede aqui e o que da para medir
 * sem olhar: se o canvas parou de mudar e se ainda tem desenho.
 *
 * Parado = duas capturas da tela, com um intervalo, saem iguais byte a byte.
 * O grao do VHS e um canvas animado por script: com a preferencia ele ja sai
 * da tela; sem ela, sai pela mao do teste, para a medida enxergar so a cena.
 */
async function telaParada(page: Page): Promise<boolean> {
  const antes = await page.screenshot({ animations: 'disabled' });
  await page.waitForTimeout(700);
  const depois = await page.screenshot({ animations: 'disabled' });
  return antes.equals(depois);
}

test('home: com reduzir movimento o fundo 3D assenta e para; sem, continua girando', async ({
  page,
}) => {
  // A cena 3D roda por software no navegador sem tela: assentar leva quadros.
  test.setTimeout(120_000);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  // A abertura inteira leva uns 12 s; com a preferencia, e um fade curto.
  // Sem clicar em pular.
  await expect(page.locator('#intro')).toBeHidden({ timeout: 8_000 });
  await expect(page.locator('#gl')).toBeVisible();

  // A camera chega ao alvo por lerp e os PNGs acendem devagar; depois disso,
  // nada mais muda na tela.
  await expect.poll(() => telaParada(page), { timeout: 60_000, intervals: [0] }).toBe(true);
  expect(await telaParada(page)).toBe(true);

  // Sem a preferencia, a mesma medida ve a corrente girando: e o que prova que
  // ela enxerga a cena, e que o "parado" de cima nao e um canvas vazio.
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  await page.locator('#skip').click();
  await page.waitForFunction(() => !document.documentElement.classList.contains('locked'));
  await page.evaluate(() => {
    for (const id of ['grain', 'scan', 'vig']) {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    }
  });
  expect(await telaParada(page)).toBe(false);
});

/**
 * A vitrine 3D com reduzir movimento (#286). Ela desenhava um quadro e parava:
 * o modelo da camiseta chegava depois e nao aparecia (ficava a silhueta), e
 * fechar e reabrir a loja ou redimensionar a janela apagava o canvas, que
 * ficava vazio.
 *
 * O CI so tem GPU por software, e nela a vitrine escolhe as fotos (#217). Aqui
 * o nome da GPU e trocado antes de qualquer script, para a vitrine escolher o
 * 3D. O modelo fica preso na rede ate a silhueta estar na tela.
 *
 * Desenhado = a captura com o canvas difere da captura com ele escondido. O
 * canvas e transparente: vazio, as duas sao o fundo da vitrine.
 */
async function vitrineDesenhada(page: Page): Promise<boolean> {
  const canvas = page.locator('#glLoja');
  const caixa = await canvas.boundingBox();
  if (!caixa) return false;
  const com = await page.screenshot({ clip: caixa, animations: 'disabled' });
  await canvas.evaluate((c: HTMLElement) => {
    c.style.visibility = 'hidden';
  });
  const sem = await page.screenshot({ clip: caixa, animations: 'disabled' });
  await canvas.evaluate((c: HTMLElement) => {
    c.style.visibility = '';
  });
  return !com.equals(sem);
}

async function capturaDaVitrine(page: Page): Promise<Buffer> {
  const caixa = await page.locator('#glLoja').boundingBox();
  if (!caixa) throw new Error('vitrine fora da tela');
  return page.screenshot({ clip: caixa, animations: 'disabled' });
}

test('home: com reduzir movimento a vitrine 3D mostra o modelo e redesenha ao reabrir e redimensionar', async ({
  page,
}) => {
  test.setTimeout(150_000);
  const erros: string[] = [];
  page.on('pageerror', (e) => erros.push(e.message));

  await page.addInitScript(() => {
    // UNMASKED_RENDERER_WEBGL, da extensao de debug que a vitrine consulta.
    const NOME_DA_GPU = 0x9246;
    const original = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function (
      this: WebGLRenderingContext,
      p: number
    ) {
      if (p === NOME_DA_GPU) return 'ANGLE (GPU de teste)';
      return Reflect.apply(original, this, [p]);
    } as typeof original;
  });

  let soltaModelo: () => void = () => {};
  const modeloPreso = new Promise<void>((solta) => {
    soltaModelo = solta;
  });
  await page.route('**/merch/camiseta.gltf', async (rota) => {
    await modeloPreso;
    await rota.continue();
  });

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.locator('#intro')).toBeHidden({ timeout: 8_000 });

  const comprar = page.locator('#comprar');
  await comprar.scrollIntoViewIfNeeded();
  await comprar.click();
  const loja = page.locator('#loja');
  await expect(loja).toBeVisible();
  await expect(page.locator('#vitrine')).not.toHaveClass(/\bmodo-360\b/);

  // A silhueta, com o brasao, e o primeiro desenho; e assenta.
  await expect.poll(() => vitrineDesenhada(page), { timeout: 30_000 }).toBe(true);
  let silhueta = await capturaDaVitrine(page);
  await expect
    .poll(
      async () => {
        await page.waitForTimeout(500);
        const agora = await capturaDaVitrine(page);
        const igual = agora.equals(silhueta);
        silhueta = agora;
        return igual;
      },
      { timeout: 30_000, intervals: [0] }
    )
    .toBe(true);

  // O modelo chega: a vitrine troca a silhueta pela camiseta, sem arraste.
  soltaModelo();
  await expect
    .poll(async () => (await capturaDaVitrine(page)).equals(silhueta), { timeout: 60_000 })
    .toBe(false);

  // Redimensionar apaga o canvas; a vitrine redesenha.
  await page.setViewportSize({ width: 1100, height: 680 });
  await expect.poll(() => vitrineDesenhada(page), { timeout: 30_000 }).toBe(true);

  // Fechar e reabrir tambem.
  await page.locator('#fecharLoja').click();
  await expect(loja).toBeHidden();
  await comprar.click();
  await expect(loja).toBeVisible();
  await expect.poll(() => vitrineDesenhada(page), { timeout: 30_000 }).toBe(true);

  expect(erros).toEqual([]);
});
