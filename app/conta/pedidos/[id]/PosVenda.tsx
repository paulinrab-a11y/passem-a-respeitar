import { CONTATO } from '@/lib/contato';
import type { Dia } from '@/lib/datas';
import {
  ARREPENDIMENTO_DIAS,
  GARANTIA_DIAS,
  type PosVenda as Situacao,
  TERMOS,
  TROCA_DE_TAMANHO_DIAS,
} from '@/lib/loja/termos';

/**
 * "Precisa cancelar, desistir ou trocar?" no detalhe do pedido (Issue #276).
 *
 * O caminho do direito de arrependimento tem que estar onde a pessoa procura
 * o pedido, e nao so numa pagina de termos. Cada etapa diz o que cabe AGORA:
 * antes de pagar, desistir e nao pagar; antes do envio, cancelar; depois da
 * entrega, os prazos.
 *
 * Datas so as que o banco sustenta (ver `posVendaDoPedido`). Sem registro de
 * entrega, a regra vai por extenso, sem contagem regressiva inventada.
 *
 * Server Component sem estado: o bloco chega pronto com o resto do pedido,
 * dentro do mesmo boundary, e e o ultimo da pagina — nada abaixo dele anda.
 */
export default function PosVenda({ situacao, numero }: { situacao: Situacao; numero: number }) {
  // O numero no assunto ja vai preenchido: e o que a loja precisa para achar
  // o pedido, e o que a pessoa mais esquece de escrever.
  const assunto = encodeURIComponent(`Pedido #${numero}`);

  return (
    <section className="detalhe-bloco" aria-labelledby="pos-venda">
      <h2 id="pos-venda">Precisa cancelar, desistir ou trocar?</h2>

      <Agora situacao={situacao} />

      <p className="detalhe-nota">
        Escreva para <a href={`mailto:${CONTATO}?subject=${assunto}`}>{CONTATO}</a> com o número do
        pedido, #{numero}. Prazos, frete e reembolso de cada caso estão nos{' '}
        <a href={TERMOS}>termos de compra</a>.
      </p>
    </section>
  );
}

/** O que cabe agora, pela etapa do pedido. */
function Agora({ situacao }: { situacao: Situacao }) {
  if (situacao.etapa === 'sem-pagamento') {
    return (
      <p className="detalhe-nota">
        Nada foi cobrado. Se desistir, é só não pagar: pedido sem pagamento não gera cobrança
        nenhuma.
      </p>
    );
  }

  if (situacao.etapa === 'antes-do-envio') {
    return (
      <p className="detalhe-nota">
        A camiseta ainda não foi enviada. Até o envio, você pode cancelar e recebe de volta tudo o
        que pagou, camiseta e frete.
      </p>
    );
  }

  if (situacao.etapa === 'a-caminho' || !situacao.prazos) {
    return (
      <p className="detalhe-nota">
        {situacao.etapa === 'a-caminho' ? 'A camiseta já foi enviada. ' : ''}
        Contando do dia em que você recebe a camiseta, são {ARREPENDIMENTO_DIAS} dias corridos para
        desistir da compra com tudo de volta e {TROCA_DE_TAMANHO_DIAS} para trocar o tamanho.
        Defeito tem garantia legal de {GARANTIA_DIAS} dias.
      </p>
    );
  }

  const p = situacao.prazos;

  return (
    <>
      <p className="detalhe-nota">
        Entregue em <Data dia={p.entregueEm} />, pela data registrada no pedido. Se a camiseta
        chegou depois, os prazos contam do dia em que você recebeu.
      </p>
      <dl className="resumo pos-venda-prazos">
        <Prazo
          rotulo="Desistir da compra"
          ate={p.arrependimentoAte}
          aberto={p.arrependimentoAberto}
        />
        <Prazo rotulo="Trocar o tamanho" ate={p.trocaAte} aberto={p.trocaAberta} />
        <Prazo rotulo="Defeito" ate={p.garantiaAte} aberto={p.garantiaAberta} />
      </dl>
    </>
  );
}

/** Uma linha do prazo: "ate" enquanto cabe, "encerrado em" depois. */
function Prazo({ rotulo, ate, aberto }: { rotulo: string; ate: Dia; aberto: boolean }) {
  return (
    <div>
      <dt>{rotulo}</dt>
      <dd>
        {aberto ? 'até ' : 'encerrado em '}
        <Data dia={ate} />
      </dd>
    </div>
  );
}

function Data({ dia }: { dia: Dia }) {
  return <time dateTime={dia.iso}>{dia.texto}</time>;
}
