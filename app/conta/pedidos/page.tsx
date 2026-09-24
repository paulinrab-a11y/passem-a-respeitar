import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { paginaValida } from '@/lib/conta/pedidos';
import { ENTRAR } from '@/lib/rotas';
import { meusPedidos } from './lista-pedidos';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Pedidos — Passem a Respeitar',
  robots: { index: false, follow: false },
};

const data = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

const AQUI = '/conta/pedidos';

/** Stagger so nos primeiros. Do quinto card em diante ninguem percebe a ordem. */
const COM_STAGGER = 4;
const PASSO_MS = 40;

export default async function Pedidos({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  const pagina = paginaValida((await searchParams).p);
  const lista = await meusPedidos(pagina);

  // Segunda verificacao, depois do middleware (#29). Aqui ela vem de graca:
  // `meusPedidos` ja precisou perguntar quem e o usuario para montar a query.
  if (!lista) redirect(ENTRAR);

  // Link velho ou digitado na mao. Pagina 1 e a unica que sempre existe.
  if (lista.pedidos.length === 0 && pagina > 1) redirect(AQUI);

  return (
    <main className="auth conta">
      <div className="auth-scan" aria-hidden="true" />
      <div className="auth-vinheta" aria-hidden="true" />

      <section className="auth-caixa conta-caixa">
        <a href="/conta" className="auth-voltar">
          ← Conta
        </a>
        <h1>Pedidos</h1>

        {lista.pedidos.length === 0 ? (
          <div className="pedidos-vazio">
            <p className="pedidos-vazio-titulo">Nada por aqui ainda.</p>
            <p>
              Quando você comprar, o pedido aparece nesta tela com número, data e o caminho que ele
              está fazendo até a sua casa.
            </p>
            <a className="btn" href="/#merch">
              Ver a merch
            </a>
          </div>
        ) : (
          <ul className="pedidos">
            {lista.pedidos.map((pedido, i) => (
              <li
                key={pedido.numero}
                style={i < COM_STAGGER ? { animationDelay: `${i * PASSO_MS}ms` } : undefined}
              >
                {/* O tom tambem vai no card, e nao so no selo: e ele que tinge
                    a borda da esquerda e deixa a lista escaneavel de longe. */}
                <article className={pedido.tom}>
                  <div className="pedido-topo">
                    {/* O link envolve so o numero, e nao o card inteiro: card
                        clicavel transforma selecionar um texto em navegacao, e
                        obriga a inventar semantica para o que ja e uma lista.
                        Aqui o alvo e o nome do pedido, que e como a pessoa se
                        refere a ele. (#42) */}
                    <h2>
                      <a href={`${AQUI}/${pedido.id}`}>Pedido #{pedido.numero}</a>
                    </h2>
                    <span className={`pedido-status ${pedido.tom}`}>{pedido.rotulo}</span>
                  </div>

                  <p className="pedido-data">
                    <time dateTime={pedido.criadoEm}>{data.format(new Date(pedido.criadoEm))}</time>
                  </p>

                  <ul className="pedido-itens">
                    {pedido.itens.map((item) => (
                      <li key={item.id}>
                        <span className="pedido-item-nome">{item.nome}</span>
                        <span className="pedido-item-detalhe">
                          {item.tamanho ? `tam. ${item.tamanho} · ` : ''}
                          {item.quantidade} × {item.precoUnitario}
                        </span>
                      </li>
                    ))}
                  </ul>

                  <p className="pedido-total">
                    <span>Total</span>
                    <strong>{pedido.total}</strong>
                  </p>

                  {/* So enquanto espera pagamento (#113). */}
                  {pedido.aguardandoPagamento ? (
                    <p className="pedido-acoes">
                      <a className="btn" href={`/checkout/pagamento/${pedido.id}`}>
                        Pagar
                      </a>
                    </p>
                  ) : null}
                </article>
              </li>
            ))}
          </ul>
        )}

        {pagina > 1 || lista.temMais ? (
          <nav className="pedidos-paginas" aria-label="Páginas de pedidos">
            {/* A pagina 1 nao carrega `?p=1`: e o mesmo conteudo em dois
                enderecos, e o de baixo e o que a pessoa guarda no favorito. */}
            {pagina > 1 ? (
              <a href={pagina === 2 ? AQUI : `${AQUI}?p=${pagina - 1}`} rel="prev">
                ← Mais recentes
              </a>
            ) : (
              <span />
            )}

            <span className="pedidos-pagina-atual">Página {pagina}</span>

            {lista.temMais ? (
              <a href={`${AQUI}?p=${pagina + 1}`} rel="next">
                Mais antigos →
              </a>
            ) : (
              <span />
            )}
          </nav>
        ) : null}
      </section>
    </main>
  );
}
