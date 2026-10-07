import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { Suspense } from 'react';
import { ehAdmin } from '@/lib/admin';
import {
  type Contagem,
  contaNoFiltro,
  FILTRO_PADRAO,
  FILTROS_ADMIN,
  leBuscaAdmin,
  linhasDaEntrega,
  montaContagem,
  statusDoFiltro,
  urlDoPainel,
} from '@/lib/conta/painel';
import { leEntrega, leFrete, leStatus, POR_PAGINA, reais } from '@/lib/conta/pedidos';
import { ehStatusPedido } from '@/lib/loja/status-do-pedido';
import { ENTRAR } from '@/lib/rotas';
import { clienteAdmin } from '@/lib/supabase/admin';
import { usuarioDaSessao } from '@/lib/supabase/servidor';
import { EsqueletoAdmin } from '../../Esqueletos';
import CopiarEndereco from './CopiarEndereco';
import MudarStatus from './MudarStatus';
import Selo from './Selo';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Pedidos — administração — Passem a Respeitar',
  robots: { index: false, follow: false },
};

const diaEHora = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

type Busca = Promise<Record<string, string | string[] | undefined>>;

/**
 * Tela administrativa de pedidos (Issue #43; filtro, paginas e endereco na #242).
 *
 * Quem nao e administrador recebe 404, nao 403: a tela nao existe para essa
 * pessoa, e a diferenca entre "nao existe" e "existe mas nao e seu" ja e
 * informacao. A conferencia vem ANTES da moldura (#160): status HTTP so existe
 * ate a resposta comecar, e um `notFound()` dentro do boundary desenharia a
 * tela certa com 200 por baixo.
 *
 * O que fica por streaming e a lista, atras do esqueleto com a forma dela.
 */
export default async function PedidosAdmin({ searchParams }: { searchParams: Busca }) {
  const usuario = await usuarioDaSessao();
  if (!usuario) redirect(ENTRAR);

  if (!ehAdmin({ email: usuario.email, emailVerificado: Boolean(usuario.email_confirmed_at) })) {
    notFound();
  }

  return (
    <main className="auth conta">
      <div className="auth-scan" aria-hidden="true" />
      <div className="auth-vinheta" aria-hidden="true" />

      <section className="auth-caixa conta-caixa">
        <a href="/conta" className="auth-voltar">
          ← Conta
        </a>
        <h1>Pedidos</h1>

        <Suspense fallback={<EsqueletoAdmin />}>
          <Painel searchParams={searchParams} />
        </Suspense>
      </section>
    </main>
  );
}

/**
 * Colunas nomeadas, nunca `select *` (#20). O que nao esta aqui — `user_id`,
 * `pagamento_id`, `pagamento_provedor`, `anonimizado_em` — nao sai do banco.
 * O endereco inteiro entrou na #242: e o que o dono precisa para a etiqueta.
 */
const COLUNAS =
  'id, numero, status, criado_em, total_centavos, frete_centavos, frete_servico, frete_prazo_dias, entrega_nome, entrega_cep, entrega_logradouro, entrega_numero, entrega_complemento, entrega_bairro, entrega_cidade, entrega_uf';

/**
 * Quem chega aqui ja passou pela conferencia de papel: so `PedidosAdmin`
 * monta este componente, e so depois de `ehAdmin`.
 *
 * Le com o client administrativo, porque a RLS — corretamente — so mostra a
 * cada um os proprios pedidos. E a unica tela do site que ve pedido alheio.
 */
async function Painel({ searchParams }: { searchParams: Busca }) {
  // `?status=` e `?p=` chegam de fora: afirmacao, nao fato. O que nao esta na
  // lista cai no padrao antes de encostar na consulta.
  const { filtro, pagina } = leBuscaAdmin(await searchParams);
  const alvo = statusDoFiltro(filtro);
  const inicio = (pagina - 1) * POR_PAGINA;

  const admin = clienteAdmin();

  let consulta = admin.from('orders').select(COLUNAS);
  if (alvo) consulta = consulta.in('status', alvo);

  // As duas idas ao banco em paralelo: a pagina e os contadores.
  const [lista, contados] = await Promise.all([
    consulta
      .order('criado_em', { ascending: false })
      // Desempate, como na lista do cliente: sem ele um pedido na fronteira
      // das paginas aparece duas vezes ou some.
      .order('numero', { ascending: false })
      // Uma linha a mais do que cabe: se ela voltar, existe proxima pagina.
      .range(inicio, inicio + POR_PAGINA),
    admin.rpc('conta_pedidos_por_status'),
  ]);

  if (lista.error) console.warn('[admin] lista indisponivel:', lista.error.code);
  const pedidos = (lista.data ?? []).slice(0, POR_PAGINA);
  const temMais = (lista.data?.length ?? 0) > POR_PAGINA;

  // Sem a RPC (migration ainda nao aplicada, banco fora do ar) a lista
  // continua: os numeros somem dos filtros, e so.
  let contagem: Contagem | null = null;
  if (contados.error) console.warn('[admin] contagem indisponivel:', contados.error.code);
  else contagem = montaContagem(contados.data ?? []);

  // Link velho ou digitado na mao. A pagina 1 de cada filtro sempre existe.
  if (pedidos.length === 0 && pagina > 1) redirect(urlDoPainel(filtro));

  return (
    <>
      <nav className="admin-filtros" aria-label="Filtrar por status">
        {FILTROS_ADMIN.map((f) => (
          <a
            key={f.valor}
            href={urlDoPainel(f.valor)}
            className="admin-filtro"
            aria-current={f.valor === filtro ? 'page' : undefined}
          >
            {f.rotulo}
            {contagem ? (
              <span className="admin-filtro-n">{contaNoFiltro(contagem, f.valor)}</span>
            ) : null}
          </a>
        ))}
      </nav>

      <p className="detalhe-nota">
        {filtro === FILTRO_PADRAO ? 'Pagos e em produção: os que precisam de etiqueta. ' : ''}
        Cada mudança fica registrada com quem fez, quando e por quê.
      </p>

      {pedidos.length === 0 ? (
        <div className="pedidos-vazio">
          <p className="pedidos-vazio-titulo">
            {filtro === 'todos' ? 'Nenhum pedido ainda.' : 'Nenhum pedido neste filtro.'}
          </p>
        </div>
      ) : (
        <ul className="pedidos">
          {pedidos.map((p) => {
            const { rotulo, tom } = leStatus(p.status);
            const frete = leFrete(p.frete_servico, p.frete_centavos, p.frete_prazo_dias);
            const entrega = leEntrega(p);
            const linhas = entrega ? linhasDaEntrega(entrega) : [];
            return (
              <li key={p.id}>
                <article className={tom}>
                  <div className="pedido-topo">
                    <h2>
                      <a href={`/conta/pedidos/${p.id}`}>Pedido #{p.numero}</a>
                    </h2>
                    <Selo rotulo={rotulo} tom={tom} />
                  </div>

                  <p className="pedido-data">
                    <time dateTime={p.criado_em}>{diaEHora.format(new Date(p.criado_em))}</time>
                    {p.entrega_nome ? ` · ${p.entrega_nome}` : ''}
                    {p.entrega_cidade ? ` · ${p.entrega_cidade}/${p.entrega_uf ?? ''}` : ''}
                  </p>

                  {/* O servico e a postagem que se compra para este
                      pedido (#199): PAC para quem escolheu PAC. */}
                  {frete ? (
                    <p className="pedido-frete">
                      <span>Enviar por {frete.servico}</span>
                      <span>{frete.valor}</span>
                    </p>
                  ) : null}

                  <p className="pedido-total">
                    <span>Total</span>
                    <strong>{reais(p.total_centavos)}</strong>
                  </p>

                  {/* O endereco inteiro, fechado por padrao (#242): sao
                      quatro linhas por card, e o que o dono precisa de
                      relance — nome e cidade — ja esta acima. Aberto, e o
                      que vai para a etiqueta, com o botao de copiar. */}
                  {entrega ? (
                    <details className="admin-entrega">
                      <summary className="admin-entrega-resumo">Endereço de entrega</summary>
                      <div className="admin-entrega-corpo">
                        <p>
                          {linhas.map((linha, i) => (
                            <span key={linha}>
                              {i > 0 ? <br /> : null}
                              {i === 0 ? <strong>{linha}</strong> : linha}
                            </span>
                          ))}
                        </p>
                        <CopiarEndereco texto={linhas.join('\n')} pedido={p.numero} />
                      </div>
                    </details>
                  ) : null}

                  {ehStatusPedido(p.status) ? (
                    <MudarStatus pedido={p.id} status={p.status} />
                  ) : null}
                </article>
              </li>
            );
          })}
        </ul>
      )}

      {pagina > 1 || temMais ? (
        <nav className="pedidos-paginas" aria-label="Páginas de pedidos">
          {pagina > 1 ? (
            <a href={urlDoPainel(filtro, pagina - 1)} rel="prev">
              ← Mais recentes
            </a>
          ) : (
            <span />
          )}

          <span className="pedidos-pagina-atual">Página {pagina}</span>

          {temMais ? (
            <a href={urlDoPainel(filtro, pagina + 1)} rel="next">
              Mais antigos →
            </a>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </>
  );
}
