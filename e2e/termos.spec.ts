import { expect, test } from '@playwright/test';

/**
 * Termos de compra (#276), no build de producao.
 *
 * Sem login e sem formulario: nada aqui gasta limite por IP, entao o arquivo
 * nao precisa de um visitante proprio (ver apoio/visitante.ts). O aceite no
 * checkout e testado em frete.spec.ts, onde ja ha uma pessoa logada.
 *
 * A suite roda sem os dados de quem vende (apoio/servidor.mjs), entao a
 * secao diz que eles estao sendo atualizados — sempre igual, em qualquer
 * maquina.
 */

test('termos: a pagina abre sem sessao, com as secoes que a lei pede', async ({ page }) => {
  const resposta = await page.goto('/termos');
  expect(resposta?.status()).toBe(200);

  await expect(page.getByRole('heading', { level: 1, name: 'Termos', exact: true })).toBeVisible();
  for (const secao of [
    'Quem vende',
    'Desistir em 7 dias',
    'Produto com defeito',
    'Troca de tamanho',
    'Como pedir',
  ]) {
    await expect(page.getByRole('heading', { level: 2, name: secao })).toBeVisible();
  }
  await expect(page.getByText(/Os dados de quem vende .+ estão sendo atualizados/)).toBeVisible();

  // Indexavel: quem procura a politica de troca antes de comprar acha.
  await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
});

test('termos: o rodape da home aponta para eles, ao lado da privacidade', async ({ request }) => {
  const html = await (await request.get('/')).text();
  const rodape = /<footer class="assina"[\s\S]*?<\/footer>/.exec(html)?.[0] ?? '';

  expect(rodape).toMatch(/href="\/privacidade"[\s\S]*href="\/termos"/);
});
