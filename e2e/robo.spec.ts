import { expect, type Page, test } from '@playwright/test';
import { criaUsuario, emailNovo, senhaNova } from './apoio/banco';
import { quantosPara } from './apoio/correio';
import { vivo } from './apoio/telas';
import { visitante } from './apoio/visitante';

// Cada arquivo e um visitante, com o IP dele: ver apoio/visitante.ts.
test.use({ extraHTTPHeaders: visitante('robo') });

/**
 * Protecao contra bot (#28), de ponta a ponta.
 *
 * A suite roda com as chaves de TESTE da Cloudflare: o widget sempre passa, e
 * a conferencia aceita qualquer token. O que se prova aqui nao e que a
 * Cloudflare separa gente de script — isso e dela. E que o site so anda com
 * token, que quem recusa e o servidor, e que a politica de seguranca deixa o
 * widget carregar sem abrir mais do que ele precisa.
 */

const CLOUDFLARE = 'https://challenges.cloudflare.com/**';
const RECUSA = 'Não deu para confirmar que você não é um robô';
const NAO_CARREGOU = 'A verificação contra robôs não carregou';

const token = (page: Page) => page.locator('input[name="cf-turnstile-response"]');

/** O que um bloqueador faz: o script da Cloudflare nao chega. */
async function semCloudflare(page: Page) {
  await page.route(CLOUDFLARE, (rota) => rota.abort());
}

/** O que um script faz: escreve em todo campo que acha, inclusive no que ninguem ve. */
async function preencheAIsca(page: Page) {
  await page.locator('input[name="website"]').evaluate((campo: HTMLInputElement) => {
    campo.value = 'https://spam.invalid';
  });
}

async function semSessao(page: Page) {
  await page.goto('/conta');
  await expect(page).toHaveURL(/\/entrar/);
}

test('login: o token chega sozinho, e com ele a senha certa entra', async ({ page }) => {
  const u = await criaUsuario('RoboEntra');
  const barrados: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && /Content Security Policy/i.test(m.text())) barrados.push(m.text());
  });

  await page.goto('/entrar');
  const entrar = await vivo(page.getByRole('button', { name: 'Entrar' }));
  await expect(token(page)).toHaveValue(/.+/);

  await page.getByLabel('E-mail').fill(u.email);
  await page.getByLabel('Senha', { exact: true }).fill(u.senha);
  await entrar.click();

  await page.waitForURL('**/conta');
  expect(barrados).toEqual([]);
});

test('login: sem token o servidor recusa, mesmo com a senha certa', async ({ page }) => {
  const u = await criaUsuario('RoboSemToken');
  await semCloudflare(page);

  await page.goto('/entrar');
  const entrar = await vivo(page.getByRole('button', { name: 'Entrar' }));
  // A pessoa fica sabendo antes de enviar, e sabe o que fazer.
  await expect(page.getByRole('alert').filter({ hasText: NAO_CARREGOU })).toBeVisible();
  await expect(token(page)).toHaveValue('');

  await page.getByLabel('E-mail').fill(u.email);
  await page.getByLabel('Senha', { exact: true }).fill(u.senha);
  await entrar.click();

  await expect(page.getByRole('alert').filter({ hasText: RECUSA })).toBeVisible();
  await semSessao(page);
});

test('login: isca preenchida recusa, mesmo com token e senha certa', async ({ page }) => {
  const u = await criaUsuario('RoboIsca');

  await page.goto('/entrar');
  const entrar = await vivo(page.getByRole('button', { name: 'Entrar' }));
  await expect(token(page)).toHaveValue(/.+/);

  await page.getByLabel('E-mail').fill(u.email);
  await page.getByLabel('Senha', { exact: true }).fill(u.senha);
  await preencheAIsca(page);
  await entrar.click();

  await expect(page.getByRole('alert').filter({ hasText: RECUSA })).toBeVisible();
  await semSessao(page);
});

test('login: a isca nao existe para quem usa teclado ou leitor de tela', async ({ page }) => {
  await page.goto('/entrar');
  await vivo(page.getByRole('button', { name: 'Entrar' }));

  const isca = page.locator('input[name="website"]');
  await expect(isca).toHaveAttribute('tabindex', '-1');
  await expect(isca).toHaveAttribute('autocomplete', 'off');
  // Na arvore de acessibilidade, que e o que o leitor de tela le, os campos
  // de texto sao os dois de sempre.
  await expect(page.getByRole('textbox', { name: 'Site' })).toHaveCount(0);
  await expect(page.getByRole('textbox')).toHaveCount(2);
  // E esta fora da tela.
  const caixa = await isca.boundingBox();
  expect((caixa?.x ?? 0) + (caixa?.width ?? 0)).toBeLessThan(0);
});

test('login: quem envia antes do token chegar espera, e entra', async ({ page }) => {
  const u = await criaUsuario('RoboApressado');
  // Rede lenta: o script da Cloudflare fica preso ate o teste soltar. Preso
  // por sinal, e nao por tempo: o teste nao depende de quem e mais rapido.
  let solta = () => {};
  const preso = new Promise<void>((resolve) => {
    solta = resolve;
  });
  await page.route(CLOUDFLARE, async (rota) => {
    if (rota.request().url().includes('/api.js')) await preso;
    await rota.continue();
  });

  await page.goto('/entrar');
  const entrar = await vivo(page.getByRole('button', { name: 'Entrar' }));

  // Todo aviso que o formulario mostrar, do envio ate a conta.
  const avisos: string[] = [];
  await page.exposeFunction('anotaAviso', (texto: string) => avisos.push(texto));
  await page.locator('form').evaluate((form) => {
    new MutationObserver(() => {
      for (const aviso of form.querySelectorAll('[role="alert"]')) {
        (window as unknown as { anotaAviso: (t: string) => void }).anotaAviso(
          aviso.textContent ?? ''
        );
      }
    }).observe(form, { childList: true, subtree: true });
  });

  await page.getByLabel('E-mail').fill(u.email);
  await page.getByLabel('Senha', { exact: true }).fill(u.senha);

  await expect(token(page)).toHaveValue('');
  await entrar.click();

  // O botao ja mostra que esta andando, e nenhum erro aparece.
  await expect(page.getByRole('button', { name: 'Entrando…' })).toBeVisible();
  await expect(page).toHaveURL(/\/entrar/);

  solta();
  await page.waitForURL('**/conta');
  // Chegou na conta sem passar por erro nenhum: nem o da espera que desiste,
  // nem a recusa do servidor.
  expect(avisos).toEqual([]);
});

// Que o token do segundo envio e NOVO, esta suite nao ve: a chave de teste
// aceita token repetido. Isso e do teste de unidade do ContraRobo. Aqui se ve
// que pedir outro token nao deixa o segundo envio sem nenhum.
test('login: depois de uma resposta, o envio seguinte tambem vai com token', async ({ page }) => {
  const u = await criaUsuario('RoboDeNovo');

  await page.goto('/entrar');
  const entrar = await vivo(page.getByRole('button', { name: 'Entrar' }));
  await page.getByLabel('E-mail').fill(u.email);
  await page.getByLabel('Senha', { exact: true }).fill(senhaNova());
  await entrar.click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'E-mail ou senha incorretos' })
  ).toBeVisible();

  // Segunda tentativa, logo em seguida: se o token gasto fosse junto, ou se
  // nenhum fosse, a resposta seria a recusa e nao a conta.
  await page.getByLabel('Senha', { exact: true }).fill(u.senha);
  await entrar.click();
  await page.waitForURL('**/conta');
});

// 320 e a tela mais estreita que o site atende, e ali o widget largo nao cabe:
// vai o compacto. 335 e 336 sao os dois lados da troca de formato.
for (const largura of [320, 335, 336, 390, 1280]) {
  test(`login: em ${largura}px o widget chega sem mexer em nada`, async ({ page }) => {
    await page.setViewportSize({ width: largura, height: 900 });

    let solta = () => {};
    const preso = new Promise<void>((resolve) => {
      solta = resolve;
    });
    await page.route(CLOUDFLARE, async (rota) => {
      if (rota.request().url().includes('/api.js')) await preso;
      await rota.continue();
    });

    await page.goto('/entrar');
    await vivo(page.getByRole('button', { name: 'Entrar' }));
    await page.evaluate(() => document.fonts.ready);
    // A pagina entra animada (#48): medir no meio da entrada e medir a
    // animacao, nao o widget.
    await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)));

    const mede = () =>
      page.evaluate(() => {
        const caixa = (seletor: string) => {
          const r = document.querySelector(seletor)?.getBoundingClientRect();
          return r ? { y: r.y, largura: r.width, altura: r.height } : null;
        };
        return {
          botao: caixa('button[type="submit"]'),
          formulario: caixa('form'),
          rolaDeLado: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        };
      });

    const antes = await mede();
    solta();
    await expect(token(page)).toHaveValue(/.+/);
    const depois = await mede();

    expect(depois).toEqual(antes);
    expect(depois.rolaDeLado).toBe(false);
  });
}

test('cadastro: sem token nao ha conta nem e-mail', async ({ page }) => {
  const email = emailNovo('robo-cadastro');
  const senha = senhaNova();
  const desde = Date.now();
  await semCloudflare(page);

  await page.goto('/criar-conta');
  const criar = await vivo(page.getByRole('button', { name: 'Criar conta' }));
  await expect(page.getByRole('alert').filter({ hasText: NAO_CARREGOU })).toBeVisible();

  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(senha);
  await page.getByLabel('Confirme a senha').fill(senha);
  await page.getByRole('checkbox', { name: /Li e aceito/ }).check();
  await criar.click();

  await expect(page.getByRole('alert').filter({ hasText: RECUSA })).toBeVisible();
  await expect(page.getByText('Confira seu e-mail')).toHaveCount(0);
  // O que foi digitado continua la: recusa nao e motivo para redigitar.
  await expect(page.getByLabel('E-mail')).toHaveValue(email);
  expect(await quantosPara(email, { desde })).toBe(0);
});

test('cadastro: isca preenchida nao cria conta nem manda e-mail', async ({ page }) => {
  const email = emailNovo('robo-isca');
  const senha = senhaNova();
  const desde = Date.now();

  await page.goto('/criar-conta');
  const criar = await vivo(page.getByRole('button', { name: 'Criar conta' }));
  await expect(token(page)).toHaveValue(/.+/);

  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(senha);
  await page.getByLabel('Confirme a senha').fill(senha);
  await page.getByRole('checkbox', { name: /Li e aceito/ }).check();
  await preencheAIsca(page);
  await criar.click();

  await expect(page.getByRole('alert').filter({ hasText: RECUSA })).toBeVisible();
  expect(await quantosPara(email, { desde })).toBe(0);
});

test('recuperacao de senha: sem token nenhum e-mail sai', async ({ page }) => {
  const u = await criaUsuario('RoboRecupera');
  const desde = Date.now();
  await semCloudflare(page);

  await page.goto('/recuperar-senha');
  const enviar = await vivo(page.getByRole('button', { name: 'Enviar link' }));
  await expect(page.getByRole('alert').filter({ hasText: NAO_CARREGOU })).toBeVisible();

  await page.getByLabel('E-mail da conta').fill(u.email);
  await enviar.click();

  await expect(page.getByRole('alert').filter({ hasText: RECUSA })).toBeVisible();
  await expect(page.getByText('Confira seu e-mail')).toHaveCount(0);
  expect(await quantosPara(u.email, { desde })).toBe(0);
});

test('convite: a rota recusa envio sem token e envio com isca', async ({ request }) => {
  const semToken = await request.post('/api/convite', { data: { codigo: 'QUALQUER' } });
  expect(semToken.status()).toBe(403);
  expect((await semToken.json()).erro).toContain(RECUSA);

  const comIsca = await request.post('/api/convite', {
    data: { codigo: 'QUALQUER', desafio: 'um-token', website: 'https://spam.invalid' },
  });
  expect(comIsca.status()).toBe(403);

  // Com token, quem responde e a conferencia do codigo: a recusa de antes era
  // do envio, nao do que foi digitado.
  const comToken = await request.post('/api/convite', {
    data: { codigo: 'QUALQUER', desafio: 'um-token', website: '' },
  });
  expect(comToken.status()).toBe(401);
  expect((await comToken.json()).erro).toBe('Esse código não abre nada aqui.');
});

test('convite: a home so carrega a Cloudflare quando a pessoa chega no campo', async ({ page }) => {
  // A cena 3D roda por software no navegador sem tela.
  test.setTimeout(90_000);

  const pedidos: string[] = [];
  const barrados: string[] = [];
  page.on('request', (r) => {
    if (r.url().startsWith('https://challenges.cloudflare.com/')) pedidos.push(r.url());
  });
  page.on('console', (m) => {
    if (m.type() === 'error' && /Content Security Policy/i.test(m.text())) barrados.push(m.text());
  });

  await page.goto('/');
  await page.locator('#skip').click();
  await page.waitForFunction(() => !document.documentElement.classList.contains('locked'));
  await page.waitForTimeout(1500);
  expect(pedidos).toEqual([]);

  const campo = page.locator('#cod');
  await campo.scrollIntoViewIfNeeded();
  await campo.focus();
  await expect.poll(() => pedidos.some((u) => u.includes('/turnstile/v0/api.js'))).toBe(true);

  // O envio espera o token e vai com ele: a resposta e a do codigo.
  await campo.fill('QUALQUER');
  await campo.press('Enter');
  await expect(page.locator('#erroCod')).toHaveText('Esse código não abre nada aqui.');

  expect(barrados).toEqual([]);
});

test('politica de seguranca: o iframe da Cloudflare abre so onde ha formulario publico', async ({
  request,
}) => {
  const frame = async (caminho: string) => {
    const r = await request.get(caminho, { maxRedirects: 0 });
    const csp = r.headers()['content-security-policy'] ?? '';
    return {
      frame: /frame-src ([^;]*)/.exec(csp)?.[1],
      script: /script-src ([^;]*)/.exec(csp)?.[1] ?? '',
      conexao: /connect-src ([^;]*)/.exec(csp)?.[1],
    };
  };

  for (const caminho of ['/', '/entrar', '/criar-conta', '/recuperar-senha']) {
    const csp = await frame(caminho);
    expect(csp.frame, caminho).toBe('https://challenges.cloudflare.com');
    // Nada alem do iframe: o script herda a confianca de quem o criou.
    expect(csp.script, caminho).not.toContain('cloudflare');
    expect(csp.conexao, caminho).toBe("'self'");
  }

  for (const caminho of ['/privacidade', '/redefinir-senha', '/conta']) {
    expect((await frame(caminho)).frame, caminho).toBe("'none'");
  }
});
