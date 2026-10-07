import type { ReactNode } from 'react';
import { FILTROS_ADMIN } from '@/lib/conta/painel';

/**
 * Esqueletos da area de conta (Issue #46).
 *
 * Cada um reusa as CLASSES do conteudo que substitui — `conta-topo`,
 * `pedidos`, `etapas` —, e nao medidas copiadas a mao. Assim a caixa do
 * esqueleto e a caixa do conteudo sao a mesma regra de CSS: mudou o padding
 * do card, mudou o esqueleto junto, e o espaco reservado continua certo.
 *
 * O texto vira uma barra (`Linha`) com um espaco dentro. O espaco e o que
 * faz a linha ter a altura da fonte de verdade; a barra so pinta.
 *
 * O esqueleto e sempre o ultimo bloco da pagina: o que fica acima dele
 * (voltar, titulo) e estatico e nao se move quando o conteudo chega. E isso
 * que mantem o layout shift em zero mesmo sem saber quantos pedidos virao.
 */

function Linha({ ch, bloco = false }: { ch: number; bloco?: boolean }) {
  return (
    <span className={`esq-linha${bloco ? ' bloco' : ''}`} style={{ width: `${ch}ch` }}>
      &nbsp;
    </span>
  );
}

function Campo() {
  return (
    <div className="auth-campo">
      <span>
        <Linha ch={12} />
      </span>
      {/* `div`, e nao `span`: a regra `.auth-campo span` e do rotulo, e
          pegaria a caixa do campo junto, com a fonte menor. */}
      <div className="esq esq-campo">&nbsp;</div>
    </div>
  );
}

function Botao({ ch, enviar = true }: { ch: number; enviar?: boolean }) {
  return (
    <span
      className={`btn${enviar ? ' auth-enviar' : ''} esq esq-botao`}
      style={{ minWidth: `${ch}ch` }}
    >
      &nbsp;
    </span>
  );
}

/**
 * Moldura comum: anuncia o carregamento uma vez, para quem ouve, e esconde
 * as barras, que para leitor de tela sao ruido.
 */
function Carregando({ children, oQue }: { children: ReactNode; oQue: string }) {
  return (
    <div className="esqueleto" role="status" aria-busy="true">
      <span className="sr">Carregando {oQue}…</span>
      <div aria-hidden="true">{children}</div>
    </div>
  );
}

export function EsqueletoPerfil() {
  return (
    <Carregando oQue="sua conta">
      <div className="conta-topo">
        <div className="conta-foto-bloco">
          <div className="conta-foto esq" />
          <div className="conta-foto-acoes">
            <span className="auth-link">
              <Linha ch={10} />
            </span>
          </div>
        </div>

        <div className="conta-identidade">
          <p className="conta-nome">
            <Linha ch={9} />
          </p>
          <p className="conta-email">
            <Linha ch={24} />
          </p>
          <p className="conta-desde">
            <Linha ch={26} />
          </p>
        </div>
      </div>

      <div className="conta-bloco">
        <Campo />
        <Botao ch={9} />
      </div>

      <p className="conta-atalho">
        <Linha ch={12} />
        <Linha ch={12} />
      </p>

      <div className="conta-sair">
        <div>
          <Botao ch={7} enviar={false} />
        </div>
        <span className="auth-link">
          <Linha ch={26} />
        </span>
      </div>
    </Carregando>
  );
}

/** Tres cards: o bastante para dizer "e uma lista" sem prometer quantos. */
export function EsqueletoPedidos() {
  return (
    <Carregando oQue="seus pedidos">
      <ul className="pedidos">
        {['a', 'b', 'c'].map((k) => (
          <li key={k}>
            <article className="normal">
              <div className="pedido-topo">
                <h2>
                  <Linha ch={11} />
                </h2>
                <span className="pedido-status esq">
                  <Linha ch={8} />
                </span>
              </div>
              <p className="pedido-data">
                <Linha ch={10} />
              </p>
              <ul className="pedido-itens">
                <li>
                  <span className="pedido-item-nome">
                    <Linha ch={16} />
                  </span>
                  <span className="pedido-item-detalhe">
                    <Linha ch={14} />
                  </span>
                </li>
              </ul>
              <p className="pedido-total">
                <span>
                  <Linha ch={5} />
                </span>
                <strong>
                  <Linha ch={8} />
                </strong>
              </p>
            </article>
          </li>
        ))}
      </ul>
    </Carregando>
  );
}

export function EsqueletoPedido() {
  return (
    <Carregando oQue="o pedido">
      <h1>
        <Linha ch={9} />
      </h1>

      <p className="detalhe-topo">
        <span className="pedido-status esq">
          <Linha ch={8} />
        </span>
        <Linha ch={10} />
      </p>

      <section className="detalhe-bloco">
        <h2>
          <Linha ch={5} />
        </h2>
        <ul className="pedido-itens">
          <li>
            <span className="pedido-item-nome">
              <Linha ch={16} />
            </span>
            <span className="pedido-item-detalhe">
              <Linha ch={14} />
            </span>
          </li>
        </ul>
        {/* A linha do frete (#199). Todo pedido novo tem; sem ela no
            esqueleto, o total descia quando o pedido chegava. */}
        <p className="pedido-frete">
          <span>
            <Linha ch={30} />
          </span>
          <span>
            <Linha ch={8} />
          </span>
        </p>
        <p className="pedido-total">
          <span>
            <Linha ch={5} />
          </span>
          <strong>
            <Linha ch={8} />
          </strong>
        </p>
      </section>

      {/* A entrega (#242): todo pedido novo tem endereco. Sem o bloco aqui,
          o andamento subia quando o pedido chegava. */}
      <section className="detalhe-bloco">
        <h2>
          <Linha ch={7} />
        </h2>
        <p className="entrega-nome">
          <Linha ch={16} />
        </p>
        <p className="entrega-endereco">
          <Linha ch={44} />
        </p>
      </section>

      <section className="detalhe-bloco">
        <h2>
          <Linha ch={9} />
        </h2>
        <ol className="etapas">
          {[12, 16, 11, 8, 9].map((ch) => (
            <li key={ch}>
              <span className="etapa-marca" />
              <span className="etapa-nome">
                <Linha ch={ch} />
              </span>
              <span className="etapa-quando">
                <Linha ch={14} />
              </span>
            </li>
          ))}
        </ol>
      </section>
    </Carregando>
  );
}

/**
 * O painel do dono (#242): a fila de filtros com a largura de cada rotulo, a
 * nota, e tres cards com o que o card de verdade tem — frete, total, a linha
 * fechada do endereco e as acoes. O `<details>` vira um bloco simples: nada
 * aqui pode receber foco.
 */
export function EsqueletoAdmin() {
  return (
    <Carregando oQue="os pedidos">
      <div className="admin-filtros">
        {FILTROS_ADMIN.map((f) => (
          <span key={f.valor} className="admin-filtro">
            <Linha ch={f.rotulo.length} />
            <Linha ch={2} />
          </span>
        ))}
      </div>
      <p className="detalhe-nota">
        <Linha ch={44} bloco />
      </p>

      <ul className="pedidos">
        {['a', 'b', 'c'].map((k) => (
          <li key={k}>
            <article className="normal">
              <div className="pedido-topo">
                <h2>
                  <Linha ch={11} />
                </h2>
                <span className="pedido-status esq">
                  <Linha ch={8} />
                </span>
              </div>
              <p className="pedido-data">
                <Linha ch={28} />
              </p>
              <p className="pedido-frete">
                <span>
                  <Linha ch={16} />
                </span>
                <span>
                  <Linha ch={8} />
                </span>
              </p>
              <p className="pedido-total">
                <span>
                  <Linha ch={5} />
                </span>
                <strong>
                  <Linha ch={8} />
                </strong>
              </p>
              <div className="admin-entrega">
                <span className="admin-entrega-resumo">
                  <Linha ch={19} />
                </span>
              </div>
              <div className="admin-acoes">
                <Campo />
                <div className="admin-botoes">
                  <Botao ch={16} enviar={false} />
                  <Botao ch={9} enviar={false} />
                </div>
              </div>
            </article>
          </li>
        ))}
      </ul>
    </Carregando>
  );
}

export function EsqueletoSeguranca() {
  return (
    <Carregando oQue="a segurança da conta">
      <p className="auth-sub">
        <Linha ch={12} />
      </p>

      <div className="conta-bloco">
        <Campo />
        <Campo />
        <div className="senha-forca">
          <div className="senha-barra" />
          {/* Vazio como o de verdade: sem senha digitada nao ha rotulo. */}
          <span />
        </div>
        <Campo />
        <Botao ch={14} />
      </div>

      <section className="troca-email">
        <h2>
          <Linha ch={14} />
        </h2>
        <p className="troca-email-atual">
          <Linha ch={24} />
        </p>
        <div className="conta-bloco">
          <Campo />
          <Campo />
          <Botao ch={14} />
        </div>
      </section>

      <section className="sessoes">
        <h2>
          <Linha ch={18} />
        </h2>
        <p className="sessoes-nota">
          <Linha ch={40} bloco />
        </p>
        <ul>
          <li>
            <div className="sessoes-quem">
              <p className="sessoes-aparelho">
                <Linha ch={18} />
              </p>
              <p className="sessoes-detalhe">
                <Linha ch={22} />
              </p>
            </div>
            <span className="sessoes-agora">
              <Linha ch={6} />
            </span>
          </li>
        </ul>
      </section>

      <section className="excluir">
        <h2>
          <Linha ch={17} />
        </h2>
        <Linha ch={22} />
      </section>
    </Carregando>
  );
}
