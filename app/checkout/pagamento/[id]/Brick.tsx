'use client';

import { initMercadoPago, Payment } from '@mercadopago/sdk-react';
import { useEffect, useMemo, useState } from 'react';

/**
 * Payment Brick (Issue #108).
 *
 * O unico lugar do projeto onde dado de cartao passa perto — e ele nao passa
 * aqui: o Brick renderiza numero, validade e CVV dentro de IFRAMES servidos
 * por `secure-fields.mercadopago.com`. Esses tres campos nunca existem no
 * nosso DOM, e o que volta para nos e um token. E por isso que a #108 abriu
 * `frame-src` para eles: sem iframe nao ha Brick, e sem Brick o cartao
 * passaria pelo nosso servidor.
 *
 * Nome do titular e CPF, que nao sao dados PCI, sao <input> comuns.
 *
 * A chave publica chega por prop, do servidor. Nao e lida aqui com
 * `process.env` porque o servidor ja precisa saber se ela existe para decidir
 * se mostra esta tela ou um recado — ler nos dois lados seriam duas verdades.
 */

export type Pagavel = {
  chavePublica: string;
  /** Em reais, como o Brick espera. A conversao de centavos ja aconteceu. */
  valor: number;
  email: string;
};

export default function Brick({ chavePublica, valor, email }: Pagavel) {
  /**
   * O `<Payment>` so entra na arvore DEPOIS do `initMercadoPago`.
   *
   * Nao e zelo: com os dois no mesmo render, o efeito roda depois da montagem
   * do filho, o Brick tenta se criar sem SDK pronto e falha com
   * "Bricks.create: Bricks component initialization failed". A customizacao
   * tambem se perde — foi assim que descobri, vendo o tema continuar claro.
   */
  const [sdkPronto, setSdkPronto] = useState(false);
  const [montado, setMontado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    initMercadoPago(chavePublica, { locale: 'pt-BR' });
    setSdkPronto(true);
  }, [chavePublica]);

  // Identidade estavel: objeto novo a cada render faria o Brick se recriar,
  // e recriar no meio de um cartao meio digitado apaga o que a pessoa digitou.
  const customizacao = useMemo(
    () =>
      ({
        paymentMethods: {
          // Pix e cartao, que e o que a #100 pede. Nada de boleto nem conta do
          // Mercado Pago: a #100 e explicita em nao obrigar o comprador a ter
          // conta la.
          bankTransfer: 'all',
          creditCard: 'all',
        },
        visual: {
          // Sem isto o Brick sai branco no meio de uma pagina preta e parece
          // um site dentro do outro. As cores sao as mesmas do globals.css,
          // repetidas aqui porque o Brick vive em iframe e nao enxerga a nossa
          // folha de estilo.
          style: {
            theme: 'dark',
            customVariables: {
              baseColor: '#e0161f',
              textPrimaryColor: '#cdd0d5',
              textSecondaryColor: '#7d8188',
              formBackgroundColor: '#08080a',
              inputBackgroundColor: '#050505',
              borderRadiusSmall: '0px',
              borderRadiusMedium: '0px',
              borderRadiusLarge: '0px',
            },
          },
        },
      }) as const,
    []
  );

  const inicializacao = useMemo(() => ({ amount: valor, payer: { email } }), [valor, email]);

  return (
    <div className="brick">
      {montado ? null : <p className="detalhe-nota">Carregando as formas de pagamento…</p>}

      {erro ? (
        <p className="conta-recado erro" role="alert">
          {erro}
        </p>
      ) : null}

      {sdkPronto ? (
        <Payment
          initialization={inicializacao}
          customization={customizacao}
          onReady={() => setMontado(true)}
          onError={() => setErro('Não consegui carregar o pagamento. Recarregue a página.')}
          onSubmit={async () => {
            // A cobranca entra na proxima Issue. Recusar aqui e mais honesto
            // que um botao que parece funcionar e nao cobra nada.
            setErro('O pagamento ainda não está ligado. Em breve.');
            throw new Error('pagamento ainda nao ligado');
          }}
        />
      ) : null}
    </div>
  );
}
