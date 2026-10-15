import type { Page } from '@playwright/test';

/**
 * Um Payment Brick de mentira, no lugar do SDK do Mercado Pago (#274).
 *
 * O Brick de verdade vive em iframes servidos por eles e precisa de rede, de
 * chave publica valida e de digitacao dentro de `secure-fields` — que o
 * navegador da suite nao consegue fazer (anotado na #45). O que se testa aqui
 * e o que a NOSSA tela faz em volta dele: o `onSubmit` de Brick.tsx, a rota de
 * cobranca, o aviso de recusa, o de analise e a tela do Pix.
 *
 * Como entra: o `@mercadopago/sdk-react` so injeta o script do SDK quando
 * `window.MercadoPago` nao existe. Este arquivo define `window.MercadoPago`
 * antes de qualquer script da pagina, e o SDK nunca e pedido. A interface e a
 * que o sdk-react usa: `new MercadoPago(chave).bricks().create(nome, id,
 * ajustes)`, com `onReady` e `onSubmit` em `ajustes.callbacks`, e um
 * controlador com `unmount()`.
 *
 * O formulario falso tem o essencial: Pix ou cartao, o cartao de teste (que
 * escolhe o cenario no Mercado Pago falso) e o nome do titular, que serve
 * para saber se o que a pessoa digitou sobreviveu a uma recusa.
 */

/** O que o formulario falso conta para o teste, em `window.__brickFalso`. */
type Contagem = { criados: number; desmontados: number };

/** Roda DENTRO da pagina, antes de tudo. Nada de fora entra aqui. */
function instala() {
  const contagem = { criados: 0, desmontados: 0 };
  const w = window as unknown as Record<string, unknown>;
  w.__brickFalso = contagem;

  type Ajustes = {
    callbacks: {
      onReady: () => void;
      onSubmit: (dados: { selectedPaymentMethod: string; formData: unknown }) => Promise<unknown>;
    };
  };

  w.MercadoPago = class {
    bricks() {
      return {
        create: async (_nome: string, idDoLugar: string, ajustes: Ajustes) => {
          contagem.criados += 1;
          const lugar = document.getElementById(idDoLugar);
          if (!lugar) throw new Error('sem lugar para o formulario falso');

          const form = document.createElement('form');
          form.className = 'brick-falso';
          form.setAttribute('aria-label', 'Formulário do Mercado Pago');
          form.innerHTML = `
            <fieldset>
              <legend>Como pagar</legend>
              <label><input type="radio" name="meio" value="cartao" checked> Cartão</label>
              <label><input type="radio" name="meio" value="pix"> Pix</label>
            </fieldset>
            <label>Cartão de teste
              <select name="cartao">
                <option value="aprovado">aprovado</option>
                <option value="recusado">recusado</option>
                <option value="semlimite">sem limite</option>
                <option value="analise">em análise</option>
              </select>
            </label>
            <label>Nome no cartão <input name="titular" autocomplete="off"></label>
            <button type="submit">Pagar</button>`;

          form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const campos = form.elements as unknown as Record<string, { value: string }>;
            const botao = form.querySelector('button') as HTMLButtonElement;
            const pix = campos.meio.value === 'pix';

            // Valor no formData de proposito: o Brick de verdade manda
            // `transaction_amount`, e a nossa tela tem que jogar fora. Quem
            // cobra o valor e o banco.
            const formData = pix
              ? { payment_method_id: 'pix', transaction_amount: 0.01 }
              : {
                  payment_method_id: 'master',
                  token: `${campos.cartao.value}${Math.random().toString(16).slice(2, 14)}`,
                  installments: 1,
                  transaction_amount: 0.01,
                  payer: { identification: { type: 'CPF', number: '12345678909' } },
                };

            botao.disabled = true;
            try {
              await ajustes.callbacks.onSubmit({
                selectedPaymentMethod: pix ? 'bank_transfer' : 'credit_card',
                formData,
              });
            } catch {
              // Rejeitar e o jeito de a tela dizer "nao deu": o Brick fica, e
              // o botao volta.
            } finally {
              botao.disabled = false;
            }
          });

          lugar.replaceChildren(form);
          ajustes.callbacks.onReady();

          return {
            unmount() {
              contagem.desmontados += 1;
              form.remove();
            },
            update() {},
          };
        },
      };
    }
  };
}

/**
 * Poe o formulario falso na pagina e anota qualquer pedido que ainda tente
 * sair para o Mercado Pago. O `playwright.config.ts` ja deixa esses hosts sem
 * endereco; a anotacao e o que deixa o teste dizer "nenhum", em vez de so
 * nao ver erro.
 */
export async function poeBrickFalso(page: Page) {
  const paraOMercadoPago: string[] = [];

  await page.route(
    /^https?:\/\/([^/]+\.)?(mercadopago|mercadolibre|mercadolivre|mlstatic)\./,
    (r) => {
      paraOMercadoPago.push(r.request().url());
      return r.abort('blockedbyclient');
    }
  );
  await page.addInitScript(instala);

  return {
    paraOMercadoPago,
    contagem: () =>
      page.evaluate(() => (window as unknown as { __brickFalso: Contagem }).__brickFalso),
  };
}
