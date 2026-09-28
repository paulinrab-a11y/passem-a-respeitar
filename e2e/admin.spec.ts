import { expect, type Page, test } from '@playwright/test';
import {
  criaAdmin,
  criaPedido,
  criaUsuario,
  type Item,
  lePedido,
  type Usuario,
} from './apoio/banco';
import { entra, vivo } from './apoio/telas';

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

let admin: Usuario;
let cliente: Usuario;
let pedido: { id: string; numero: number };

// Em serie: o ultimo teste le o que o penultimo gravou. Se um falha, os
// seguintes sao pulados, em vez de rodarem contra um pedido recriado.
test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  admin = await criaAdmin();
  cliente = await criaUsuario('Cliente');
  pedido = await criaPedido(cliente, [ITEM], ['pago']);
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

  const separar = await vivo(card(page).getByRole('button', { name: 'Pôr em separação' }));
  await card(page).getByLabel('Motivo (opcional)').fill(MOTIVO);
  await separar.click();

  await expect(selo).toHaveText('Em produção');
  await expect(
    card(page).getByRole('alert').filter({ hasText: 'Status atualizado' })
  ).toBeVisible();
  // Os botoes agora sao os da etapa seguinte, e o motivo nao vale para ela.
  await expect(card(page).getByRole('button', { name: 'Marcar enviado' })).toBeVisible();
  await expect(card(page).getByRole('button', { name: 'Pôr em separação' })).toHaveCount(0);
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
