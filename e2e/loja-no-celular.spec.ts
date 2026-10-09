import { expect, type Locator, type Page, test } from '@playwright/test';
import { visitante } from './apoio/visitante';

// Cada arquivo e um visitante, com o IP dele: ver apoio/visitante.ts.
test.use({ extraHTTPHeaders: visitante('loja-no-celular') });

/**
 * A loja no celular (#294), no projeto `celular` do playwright.config.ts:
 * Pixel 5, com toque.
 *
 * A vitrine em fotos nao respondia ao dedo. O navegador tomava o arraste como
 * rolagem e cancelava o ponteiro antes do primeiro quadro, e o toque ainda
 * parava a rotacao automatica. O que decide e o `touch-action`, que so o
 * navegador aplica: por isso o arraste aqui e toque de verdade, pelo protocolo
 * do Chromium, e nao evento sintetico no DOM, que passaria por cima dele.
 *
 * Sem WebGL a loja abre sempre em fotos (#217, #238), com GPU ou sem: e o
 * aparelho para quem o modo 360 existe.
 */

async function abreLojaEmFotos(page: Page, erros: string[], reduz: boolean) {
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

  await page.emulateMedia({ reducedMotion: reduz ? 'reduce' : 'no-preference' });
  await page.goto('/');
  await expect(page.locator('html')).toHaveClass(/\bsem-webgl\b/);
  // Com reduzir movimento a abertura e um fade curto e fecha sozinha.
  if (!reduz) await page.locator('#skip').tap();
  await page.waitForFunction(() => !document.documentElement.classList.contains('locked'));

  await page.locator('#comprar').tap();
  await expect(page.locator('#loja')).toBeVisible();
  await expect(page.locator('#vitrine')).toHaveClass(/\bmodo-360\b/);
}

/** O quadro na tela: a posicao da tira de quatro fotos. */
function quadro(page: Page): Promise<string> {
  return page.locator('#vitrine .giro').evaluate((g: HTMLElement) => g.style.backgroundPosition);
}

/** Arrasta o dedo do centro de `alvo`, em dez passos, `dx` e `dy` pixels. */
async function arrastaComDedo(page: Page, alvo: Locator, dx: number, dy: number) {
  const caixa = await alvo.boundingBox();
  if (!caixa) throw new Error('alvo fora da tela');
  const x = caixa.x + caixa.width / 2 - dx / 2;
  const y = caixa.y + caixa.height / 2 - dy / 2;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let i = 1; i <= 10; i++) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: x + (dx * i) / 10, y: y + (dy * i) / 10 }],
    });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

test('loja no celular: arrastar a foto gira a camiseta, e na vertical o modal rola', async ({
  page,
}) => {
  const erros: string[] = [];
  // Com reduzir movimento as fotos nao giram sozinhas: o quadro so muda pelo
  // dedo, e o teste le o quadro exato.
  await abreLojaEmFotos(page, erros, true);

  const giro = page.locator('#vitrine .giro');
  const loja = page.locator('#loja');
  expect(await quadro(page)).toBe('0% 50%');

  // 100 px para a direita: um quadro para tras. Antes, o navegador cancelava o
  // ponteiro uns 40 px depois e nada girava.
  await arrastaComDedo(page, giro, 100, 0);
  await expect.poll(() => quadro(page)).toBe('100% 50%');
  await expect(page.locator('#vitrine')).toHaveClass(/\busada\b/);

  // Na vertical o dedo continua rolando o modal, e a camiseta fica onde esta.
  const rolagem = () => loja.evaluate((el) => el.scrollTop);
  expect(await loja.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  expect(await rolagem()).toBe(0);
  await arrastaComDedo(page, giro, 0, -120);
  await expect.poll(rolagem).toBeGreaterThan(0);
  expect(await quadro(page)).toBe('100% 50%');

  expect(erros).toEqual([]);
});

test('loja no celular: toque simples nao congela a rotacao, e reabrir a loja religa', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const erros: string[] = [];
  await abreLojaEmFotos(page, erros, false);

  const giro = page.locator('#vitrine .giro');
  const vitrine = page.locator('#vitrine');
  const anda = async () => {
    const agora = await quadro(page);
    await expect.poll(() => quadro(page), { timeout: 10_000 }).not.toBe(agora);
  };

  // Gira sozinha ao abrir.
  await anda();

  // Encostar sem arrastar parava a rotacao e escondia a dica.
  await giro.tap();
  await expect(vitrine).not.toHaveClass(/\busada\b/);
  await anda();

  // O arraste que troca o quadro e o que para.
  await arrastaComDedo(page, giro, -100, 0);
  await expect(vitrine).toHaveClass(/\busada\b/);

  // Fechar e reabrir religa: antes, depois do arraste, ela nao voltava mais.
  await page.locator('#fecharLoja').tap();
  await expect(page.locator('#loja')).toBeHidden();
  await page.locator('#comprar').tap();
  await expect(page.locator('#loja')).toBeVisible();
  await anda();

  expect(erros).toEqual([]);
});
