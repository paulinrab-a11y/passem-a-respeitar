import Copiar from '@/app/_ui/Copiar';
import { RASTREIO_DOS_CORREIOS, type RastreioDoPedido } from '@/lib/loja/rastreio';

/**
 * O codigo de rastreio do pedido enviado (Issue #378), no detalhe do cliente
 * e no do dono.
 *
 * A pagina dos Correios pede captcha a cada consulta e nao aceita o codigo
 * pela URL, entao o caminho e o mais curto que existe: copiar aqui, colar la.
 * O link que o dono gravou (Melhor Envio, por exemplo) vem por ultimo,
 * quando existe.
 *
 * Server Component: o unico pedaco com estado e o botao de copiar.
 */
export default function Rastreio({ rastreio }: { rastreio: RastreioDoPedido }) {
  return (
    <section className="detalhe-bloco" aria-labelledby="rastreio">
      <h2 id="rastreio">Rastreio</h2>

      <p className="rastreio-codigo">
        {/* Selecionavel e em fonte de largura fixa: e o que a pessoa compara
            letra a letra com a etiqueta ou com o app dos Correios. */}
        <code>{rastreio.codigo}</code>
      </p>

      <div className="rastreio-acoes">
        <Copiar
          texto={rastreio.codigo}
          rotulo="Copiar código"
          copiado="Código copiado."
          falhou="Não deu para copiar. Selecione o código acima."
        />
        <a className="btn" href={RASTREIO_DOS_CORREIOS} target="_blank" rel="noopener noreferrer">
          Rastrear nos Correios
          <span className="sr"> (abre em outra aba)</span>
        </a>
      </div>

      <p className="detalhe-nota">
        Na página dos Correios, cole o código no campo de busca.
        {rastreio.url ? (
          <>
            {' '}
            Ou acompanhe pelo{' '}
            <a href={rastreio.url} target="_blank" rel="noopener noreferrer">
              link da transportadora
              <span className="sr"> (abre em outra aba)</span>
            </a>
            .
          </>
        ) : null}
      </p>
    </section>
  );
}
