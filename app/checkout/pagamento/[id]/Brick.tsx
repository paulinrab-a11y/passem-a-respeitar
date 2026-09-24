'use client';

import { initMercadoPago, Payment } from '@mercadopago/sdk-react';
import { useEffect, useState } from 'react';

/**
 * Payment Brick (Issue #108).
 *
 * O unico lugar do projeto onde dado de cartao existe — e ele nao existe aqui:
 * o Brick renderiza os campos dentro de IFRAMES do Mercado Pago. O numero e o
 * CVV ficam no domínio deles, nunca no nosso DOM, e o que volta para nos e um
 * token. E por isso que `frame-src` precisou ser aberto para eles na #108: sem
 * iframe nao ha Brick, e sem Brick o cartao passaria pelo nosso servidor.
 *
 * A chave publica chega por prop, do servidor. Nao e lida aqui com
 * `process.env` porque o servidor ja precisa saber se ela existe para decidir
 * se mostra esta tela ou um recado — e ler nos dois lugares seria duas
 * verdades.
 */

export type Pagavel = {
  chavePublica: string;
  /** Em reais, como o Brick espera. A conversao de centavos ja aconteceu. */
  valor: number;
  email: string;
};

export default function Brick({ chavePublica, valor, email }: Pagavel) {
  const [pronto, setPronto] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    // `locale` explicito: sem ele o Brick escolhe pelo navegador, e a loja
    // vende so no Brasil.
    initMercadoPago(chavePublica, { locale: 'pt-BR' });
  }, [chavePublica]);

  return (
    <div className="brick">
      {/* O esqueleto fica atras ate o Brick avisar que montou. Sem isso a area
          fica em branco por um segundo e parece que a tela quebrou. */}
      {pronto ? null : <p className="detalhe-nota">Carregando as formas de pagamento…</p>}

      {erro ? (
        <p className="conta-recado erro" role="alert">
          {erro}
        </p>
      ) : null}

      <Payment
        initialization={{ amount: valor, payer: { email } }}
        customization={{
          paymentMethods: {
            // Pix e cartao, que e o que a #100 pede. Nada de boleto nem
            // conta do Mercado Pago: a #100 e explicita em nao obrigar o
            // comprador a ter conta la.
            bankTransfer: 'all',
            creditCard: 'all',
          },
        }}
        onReady={() => setPronto(true)}
        onError={() => setErro('Não consegui carregar o pagamento. Recarregue a página.')}
        onSubmit={async () => {
          // A cobranca entra na proxima Issue. Recusar aqui e melhor que um
          // botao que parece funcionar e nao cobra nada.
          setErro('O pagamento ainda não está ligado. Em breve.');
          throw new Error('pagamento ainda nao ligado');
        }}
      />
    </div>
  );
}
