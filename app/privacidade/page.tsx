import type { Metadata } from 'next';
import { CONTATO } from '@/lib/contato';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Privacidade — Passem a Respeitar',
};

/**
 * Politica de privacidade (Issue #109).
 *
 * Nasceu por uma razao concreta: a tela de pagamento passou a deixar o
 * Mercado Pago coletar dados do dispositivo para antifraude, e isso e
 * tratamento de dado pessoal — nao entra em silencio. O resto do texto
 * descreve o que o site ja fazia.
 *
 * Escrita para ser lida, nao para parecer contrato: frases curtas, cada
 * secao responde a uma pergunta. Sem data de "ultima atualizacao" inventada
 * — a data e a do commit.
 */
export default function Privacidade() {
  return (
    <main className="auth conta">
      <div className="auth-scan" aria-hidden="true" />
      <div className="auth-vinheta" aria-hidden="true" />

      <section className="auth-caixa conta-caixa">
        <a href="/" className="auth-voltar">
          ← Passem a Respeitar
        </a>

        <h1>Privacidade</h1>

        <p className="detalhe-nota">
          Este site é da WhyNot Records, para o EP <em>Passem a Respeitar</em> (Santxx x Ch3fe).
          Aqui está o que guardamos sobre você, por quê, e o que você pode fazer a respeito.
        </p>

        <section className="detalhe-bloco">
          <h2>O que guardamos</h2>
          <p className="detalhe-nota">
            <strong>Conta:</strong> e-mail, nome e, se você enviar, uma foto. Servem para você
            entrar, ver seus pedidos e receber avisos sobre eles.
          </p>
          <p className="detalhe-nota">
            <strong>Pedidos:</strong> o que você comprou, quanto pagou, e o endereço de entrega. Sem
            o endereço a camiseta não chega.
          </p>
          <p className="detalhe-nota">
            <strong>Pagamento:</strong> o pagamento é processado pelo Mercado Pago. O número do seu
            cartão e o código de segurança <strong>nunca passam pelos nossos servidores</strong>:
            eles são digitados em campos que pertencem ao Mercado Pago. Nós guardamos só o resultado
            — aprovado, pendente, recusado — e um identificador da transação.
          </p>
        </section>

        <section className="detalhe-bloco">
          <h2>Prevenção a fraude na tela de pagamento</h2>
          <p className="detalhe-nota">
            Enquanto você está na tela de pagamento, o Mercado Pago e o Mercado Livre coletam dados
            do seu dispositivo para calcular o risco de fraude: características do navegador, do
            sistema e da conexão, e a página de onde você veio. Isso acontece{' '}
            <strong>só nessa tela</strong> — na home e no resto do site, não.
          </p>
          <p className="detalhe-nota">
            Fazemos isso porque, sem esses dados, mais pagamentos legítimos são recusados. Esses
            dados vão para o Mercado Pago, não para nós, e valem a{' '}
            <a
              href="https://www.mercadopago.com.br/privacidade"
              target="_blank"
              rel="noopener noreferrer"
            >
              política de privacidade deles
            </a>
            .
          </p>
        </section>

        <section className="detalhe-bloco">
          <h2>O que não fazemos</h2>
          <p className="detalhe-nota">
            Não vendemos nem cedemos seus dados. Não usamos rastreador de publicidade. Não guardamos
            senha em texto: só um hash, que não volta a ser a senha.
          </p>
        </section>

        <section className="detalhe-bloco">
          <h2>Por quanto tempo</h2>
          <p className="detalhe-nota">
            Enquanto sua conta existir. Se você apagar a conta, seus pedidos ficam registrados para
            fins fiscais, mas <strong>desvinculados de você</strong>: nome e endereço de entrega são
            apagados do pedido no mesmo instante.
          </p>
        </section>

        <section className="detalhe-bloco">
          <h2>Seus direitos</h2>
          <p className="detalhe-nota">
            Pela LGPD você pode pedir para ver, corrigir ou apagar seus dados, e saber com quem eles
            foram compartilhados. Nome e foto você mesmo edita em <a href="/conta">Conta</a>; o
            resto, é só pedir por <a href={`mailto:${CONTATO}`}>{CONTATO}</a>, e respondemos.
          </p>
        </section>
      </section>
    </main>
  );
}
