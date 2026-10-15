import type { Metadata } from 'next';
import { CONTATO } from '@/lib/contato';
import { formataData } from '@/lib/datas';
import { PRAZO_DE_PRODUCAO_DIAS } from '@/lib/loja/prazo';
import {
  ARREPENDIMENTO_DIAS,
  CONSERTO_DIAS,
  GARANTIA_DIAS,
  RESPOSTA_DIAS_UTEIS,
  TERMOS_ATUALIZADOS_EM,
  TROCA_DE_TAMANHO_DIAS,
} from '@/lib/loja/termos';
import { dadosDoVendedor } from '@/lib/loja/vendedor';

// Os dados de quem vende sao lidos do ambiente a cada visita: cadastrados na
// Vercel, aparecem aqui sem depender de um build ter pego a variavel.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Termos de compra — Passem a Respeitar',
  description:
    'Quem vende, prazos, pagamento, cancelamento, direito de arrependimento, defeito e troca da Camiseta CBAC.',
};

/**
 * Termos de compra, trocas e arrependimento (Issue #276).
 *
 * Mesmo desenho da /privacidade: frases curtas, cada secao responde a uma
 * pergunta, e cada promessa sai do que o site faz de verdade. As regras sao o
 * padrao brasileiro — Codigo de Defesa do Consumidor e Decreto 7.962/2013 —,
 * por decisao do dono em 09/10/2026, com a base legal nomeada em cada uma.
 *
 * O que NAO esta aqui, de proposito: e-mail automatico de pedido (o site
 * ainda nao manda nenhum, #250), contagem de prazo que o banco nao sustenta,
 * e qualquer dado de quem vende que nao venha das variaveis do servidor.
 *
 * Os numeros moram em lib/loja/termos.ts e lib/loja/prazo.ts: o detalhe do
 * pedido repete os mesmos prazos, e o teste amarra os dois lados.
 */
export default function Termos() {
  const vendedor = dadosDoVendedor();

  return (
    <main className="auth conta">
      <div className="auth-scan" aria-hidden="true" />
      <div className="auth-vinheta" aria-hidden="true" />

      <section className="auth-caixa conta-caixa">
        <a href="/" className="auth-voltar">
          ← Passem a Respeitar
        </a>

        {/* Uma palavra, como as outras telas: "Termos de compra" quebrava em
            duas linhas no telefone, e o titulo de entrelinha curta da
            identidade encavalava uma linha na outra. O resto vai embaixo, no
            mesmo subtitulo de /recuperar-senha. Medido no preview. */}
        <h1>Termos</h1>
        <p className="auth-sub">De compra, troca e arrependimento</p>

        <p className="detalhe-nota termos-intro">
          O que vale quando você compra a Camiseta CBAC neste site: quem vende, quanto custa, como
          paga, e como cancelar, desistir ou trocar.
        </p>

        <section className="detalhe-bloco" id="quem-vende">
          <h2>Quem vende</h2>
          {vendedor ? (
            <p className="detalhe-nota">
              <strong>{vendedor.nome}</strong>, {vendedor.tipoDoDocumento} {vendedor.documento}.
              Endereço: {vendedor.endereco}. Contato: <a href={`mailto:${CONTATO}`}>{CONTATO}</a>.
            </p>
          ) : (
            <p className="detalhe-nota">
              Os dados de quem vende — nome, CPF ou CNPJ e endereço — estão sendo atualizados.
              Enquanto isso, o contato é <a href={`mailto:${CONTATO}`}>{CONTATO}</a>.
            </p>
          )}
          <p className="detalhe-nota">
            A lei manda toda loja na internet dizer quem é e como falar com ela (Decreto 7.962/2013,
            art. 2º).
          </p>
        </section>

        <section className="detalhe-bloco" id="o-que-voce-compra">
          <h2>O que você compra</h2>
          <p className="detalhe-nota">
            A Camiseta CBAC, feita sob encomenda: a produção começa depois do pedido e leva pelo
            menos {PRAZO_DE_PRODUCAO_DIAS} dias. O transporte dos Correios começa depois dela, no
            prazo que aparece na escolha do frete.
          </p>
          <p className="detalhe-nota">
            O preço da camiseta, o frete e o total aparecem antes de você pagar. O frete é calculado
            pelo CEP de entrega, com o preço dos Correios, pelo Melhor Envio. O total que você vê no
            checkout é o que é cobrado.
          </p>
        </section>

        <section className="detalhe-bloco" id="pagamento">
          <h2>Pagamento</h2>
          <p className="detalhe-nota">
            Por Pix ou cartão, pelo Mercado Pago. O número do cartão e o código de segurança são
            digitados em campos do Mercado Pago e <strong>nunca passam pelo site</strong>.
          </p>
          <p className="detalhe-nota">
            Pagamento recusado ou Pix vencido não cobra nada. O pedido continua salvo, aguardando
            pagamento, e você tenta de novo pela página dele, em{' '}
            <a href="/conta/pedidos">Meus pedidos</a>: outro cartão ou um Pix novo. O Pix vale até o
            horário que aparece junto do código; depois disso, não pode mais ser pago. Pedido que
            nunca é pago não gera cobrança nenhuma e pode ser cancelado pela loja.
          </p>
        </section>

        <section className="detalhe-bloco" id="cancelar">
          <h2>Cancelar antes do envio</h2>
          <p className="detalhe-nota">
            Até a camiseta ser enviada, você pode cancelar o pedido, por qualquer motivo, mesmo com
            a produção começada. Você recebe de volta <strong>tudo o que pagou</strong>, camiseta e
            frete, pelo mesmo meio de pagamento.
          </p>
        </section>

        <section className="detalhe-bloco" id="arrependimento">
          <h2>Desistir em {ARREPENDIMENTO_DIAS} dias</h2>
          <p className="detalhe-nota">
            Quem compra pela internet pode desistir em até {ARREPENDIMENTO_DIAS} dias corridos,
            contados do dia em que recebe a camiseta, sem precisar dar motivo. É o direito de
            arrependimento (Código de Defesa do Consumidor, art. 49, e Decreto 7.962/2013, art. 5º).
          </p>
          <p className="detalhe-nota">
            A camiseta é feita sob encomenda, mas nos tamanhos de sempre, iguais para todo mundo:{' '}
            <strong>o direito de arrependimento vale do mesmo jeito</strong>.
          </p>
          <p className="detalhe-nota">
            Você recebe de volta tudo o que pagou, <strong>inclusive o frete da entrega</strong>. O
            frete para devolver é por conta da loja: depois do seu pedido de desistência,
            respondemos com as instruções de postagem.
          </p>
          <p className="detalhe-nota">
            O dinheiro volta pelo mesmo meio de pagamento. No Pix, para a conta que pagou. No
            cartão, como estorno na fatura, que pode levar até duas faturas para aparecer,
            dependendo do banco.
          </p>
        </section>

        <section className="detalhe-bloco" id="defeito">
          <h2>Produto com defeito</h2>
          <p className="detalhe-nota">
            A camiseta tem garantia legal de {GARANTIA_DIAS} dias contra defeito, contados do
            recebimento (Código de Defesa do Consumidor, art. 26). Defeito que não dava para ver na
            hora — que aparece com o uso — conta a partir de quando aparece.
          </p>
          <p className="detalhe-nota">
            A loja tem até {CONSERTO_DIAS} dias para resolver. Se não resolver, você escolhe: uma
            camiseta nova, o dinheiro de volta ou um desconto proporcional no preço (art. 18). O
            frete de ida e de volta, nesse caso, é por conta da loja.
          </p>
        </section>

        <section className="detalhe-bloco" id="troca">
          <h2>Troca de tamanho</h2>
          <p className="detalhe-nota">
            Não serviu? Além do que a lei manda, a loja troca o tamanho em até{' '}
            {TROCA_DE_TAMANHO_DIAS} dias corridos do recebimento, se a camiseta não tiver sido usada
            nem lavada, e voltar como chegou, com etiqueta. A troca depende de haver o tamanho novo
            em estoque; se não houver, você recebe o dinheiro de volta.
          </p>
          <p className="detalhe-nota">
            Na troca, o frete para mandar a camiseta de volta é seu, e o do tamanho novo é da loja.
            Se preferir desistir da compra, vale o direito de arrependimento, acima, com o frete
            todo por conta da loja.
          </p>
        </section>

        <section className="detalhe-bloco" id="como-pedir">
          <h2>Como pedir</h2>
          <p className="detalhe-nota">
            Para cancelar, desistir, avisar de defeito ou trocar, escreva para{' '}
            <a href={`mailto:${CONTATO}`}>{CONTATO}</a> com o número do pedido — ele está em{' '}
            <a href="/conta/pedidos">Meus pedidos</a>. Se for defeito, mande uma foto.
          </p>
          <p className="detalhe-nota">
            Assim que o seu e-mail chega, respondemos confirmando o recebimento. A solução vem em
            até {RESPOSTA_DIAS_UTEIS} dias úteis. O site não manda e-mail sozinho sobre pedidos: o
            que vale é a conversa por esse endereço.
          </p>
        </section>

        <section className="detalhe-bloco" id="lei">
          <h2>Lei e foro</h2>
          <p className="detalhe-nota">
            Valem as leis do Brasil, em especial o Código de Defesa do Consumidor. Se for preciso ir
            à Justiça, você pode entrar com a ação na cidade onde mora (art. 101, I).
          </p>
          <p className="detalhe-nota">
            Ao finalizar a compra, você marca que leu e aceitou estes termos, e o pedido guarda a
            data e a hora desse aceite.
          </p>
        </section>

        <p className="detalhe-nota termos-data">
          Termos atualizados em{' '}
          <time dateTime={TERMOS_ATUALIZADOS_EM.slice(0, 10)}>
            {formataData(TERMOS_ATUALIZADOS_EM)}
          </time>
          .
        </p>
      </section>
    </main>
  );
}
