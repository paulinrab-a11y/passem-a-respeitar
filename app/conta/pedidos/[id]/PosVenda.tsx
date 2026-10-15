import { NOME_DO_TIPO, type Solicitacao, tiposAbertos, tiposQueCabem } from '@/lib/conta/pos-venda';
import { CONTATO } from '@/lib/contato';
import { type Dia, formataDataHora } from '@/lib/datas';
import {
  ARREPENDIMENTO_DIAS,
  GARANTIA_DIAS,
  type PosVenda as Situacao,
  TERMOS,
  TROCA_DE_TAMANHO_DIAS,
} from '@/lib/loja/termos';
import PedirPosVenda from './PedirPosVenda';

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
 * Os botoes de pedir pelo site entraram na #379 (Decreto 7.962/2013, art.
 * 5º, § 1º: desistir pela mesma ferramenta em que comprou). O e-mail fica
 * como alternativa. O que ja foi pedido aparece com o protocolo, aberto ou
 * encerrado, e o botao daquele tipo da lugar a ele enquanto estiver aberto.
 *
 * Server Component: o bloco chega pronto com o resto do pedido, dentro do
 * mesmo boundary, e e o ultimo da pagina — nada abaixo dele anda. So os
 * botoes sao de cliente.
 */
export default function PosVenda({
  situacao,
  numero,
  pedido,
  solicitacoes = [],
}: {
  /** Nulo no pedido cancelado ou reembolsado: so a lista do que foi pedido. */
  situacao: Situacao | null;
  numero: number;
  /** Id do pedido. Sem ele, o bloco nao oferece pedir pelo site. */
  pedido?: string;
  solicitacoes?: readonly Solicitacao[];
}) {
  // O numero no assunto ja vai preenchido: e o que a loja precisa para achar
  // o pedido, e o que a pessoa mais esquece de escrever.
  const assunto = encodeURIComponent(`Pedido #${numero}`);
  // O que cabe pela etapa, menos o que ja esta aberto: esse aparece na lista
  // com o protocolo, e um segundo clique nao abre outro.
  const abertos = tiposAbertos(solicitacoes);
  const podePedir = pedido ? tiposQueCabem(situacao).filter((t) => !abertos.has(t)) : [];

  return (
    <section className="detalhe-bloco" aria-labelledby="pos-venda">
      <h2 id="pos-venda">Precisa cancelar, desistir ou trocar?</h2>

      {situacao ? <Agora situacao={situacao} /> : null}

      {solicitacoes.length > 0 ? <Pedidas solicitacoes={solicitacoes} /> : null}

      {pedido ? <PedirPosVenda pedido={pedido} tipos={podePedir} /> : null}

      <p className="detalhe-nota">
        {podePedir.length > 0 ? 'Se preferir, escreva' : 'Escreva'} para{' '}
        <a href={`mailto:${CONTATO}?subject=${assunto}`}>{CONTATO}</a> com o número do pedido, #
        {numero}. Prazos, frete e reembolso de cada caso estão nos{' '}
        <a href={TERMOS}>termos de compra</a>.
      </p>
    </section>
  );
}

/** O que ja foi pedido pelo site, com protocolo, do mais novo ao mais antigo. */
function Pedidas({ solicitacoes }: { solicitacoes: readonly Solicitacao[] }) {
  return (
    <ul className="pos-venda-lista">
      {solicitacoes.map((s) => (
        <li key={s.protocolo}>
          <span className="pos-venda-lista-nome">
            {NOME_DO_TIPO[s.tipo]} · protocolo{' '}
            <strong className="pos-venda-protocolo">{s.protocolo}</strong>
          </span>
          <span className="pos-venda-lista-quando">
            Pedido em <time dateTime={s.criadoEm}>{formataDataHora(s.criadoEm)}</time>
            {s.resolvidaEm ? (
              <>
                {' '}
                · encerrado em{' '}
                <time dateTime={s.resolvidaEm}>{formataDataHora(s.resolvidaEm)}</time>
              </>
            ) : (
              ' · aguardando a loja'
            )}
          </span>
        </li>
      ))}
    </ul>
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
        Defeito tem garantia legal de {GARANTIA_DIAS} dias; o que só aparece com o uso conta a
        partir de quando aparece.
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
        {/* Sem "encerrado": defeito que aparece com o uso conta de quando
            aparece (CDC, art. 26, § 3º), e esse dia o pedido nao tem. */}
        <div>
          <dt>Defeito</dt>
          <dd>
            até <Data dia={p.garantiaAte} />; se aparecer com o uso, {GARANTIA_DIAS} dias a partir
            de quando aparecer
          </dd>
        </div>
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
