'use client';

import { initMercadoPago, Payment } from '@mercadopago/sdk-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import Pix, { type DadosDoPix } from './Pix';

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
  valorEscrito: string;
  email: string;
  pedido: string;
};

/** O que o Brick entrega no submit. Nada aqui e valor de dinheiro. */
type DadosDoBrick = {
  payment_method_id?: string;
  token?: string;
  installments?: number;
  payer?: { identification?: { type?: string; number?: string } };
};

export default function Brick({ chavePublica, valor, valorEscrito, email, pedido }: Pagavel) {
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
  const [pix, setPix] = useState<DadosDoPix | null>(null);
  const router = useRouter();

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

  // O esqueleto cede o lugar quando o formulario avisa que montou — ou quando
  // ele falha: erro com esqueleto brilhando atras diria "ainda carregando".
  const pronto = montado || Boolean(erro);

  return (
    <div className="brick">
      {erro ? (
        <p className="conta-recado erro" role="alert">
          {erro}
        </p>
      ) : null}

      {pix ? <Pix dados={pix} valor={valorEscrito} /> : null}

      {/* Lugar reservado (#154). O formulario do Mercado Pago chega em quatro
          saltos, de 20 a 359 px, e empurrava o aviso de privacidade 339 px
          para baixo com a pessoa prestes a pagar. Aqui o lugar existe desde o
          primeiro byte: esqueleto e formulario ocupam a MESMA celula, e o
          formulario so aparece quando esta inteiro. */}
      {pix ? null : (
        <div className="brick-pilha" data-pronto={pronto ? '' : undefined}>
          {pronto ? null : (
            <p className="sr" role="status">
              Carregando as formas de pagamento…
            </p>
          )}

          {/* Titulo, os dois meios de pagamento e o botao: o formato do
              formulario antes de a pessoa escolher como pagar. */}
          <div className="esq-brick" aria-hidden="true">
            <span className="esq-brick-titulo esq" />
            <div className="esq-brick-meios">
              <span className="esq" />
              <span className="esq" />
            </div>
            <span className="esq-brick-botao esq" />
          </div>

          <div className="brick-form">
            {sdkPronto ? (
              <Payment
                initialization={inicializacao}
                customization={customizacao}
                onReady={() => setMontado(true)}
                onError={() => setErro('Não consegui carregar o pagamento. Recarregue a página.')}
                onSubmit={async ({ formData }) => {
                  setErro(null);
                  const d = (formData ?? {}) as DadosDoBrick;

                  // So escolha vai no corpo. Valor, total e moeda nao existem aqui —
                  // o servidor le de `orders.total_centavos`.
                  const r = await fetch('/api/checkout/pagamento', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      pedido,
                      payment_method_id: d.payment_method_id,
                      token: d.token,
                      installments: d.installments,
                      payer: d.payer?.identification
                        ? { identification: d.payer.identification }
                        : undefined,
                    }),
                  }).catch(() => null);

                  if (!r) {
                    setErro('Não consegui falar com o pagamento. Tente de novo.');
                    throw new Error('rede');
                  }

                  const corpo = await r.json().catch(() => ({}));

                  if (!r.ok) {
                    setErro(
                      corpo.erro ?? 'O pagamento não foi aprovado. Você pode tentar de novo.'
                    );
                    // Rejeitar mantem o Brick vivo com o que a pessoa digitou, em vez
                    // de limpar o formulario e obrigar a redigitar o cartao.
                    throw new Error('recusado');
                  }

                  if (corpo.pix) {
                    setPix(corpo.pix);
                    return;
                  }

                  // Cartao aprovado ou em analise: o pedido e quem conta a historia.
                  router.push(`/conta/pedidos/${pedido}`);
                }}
              />
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
