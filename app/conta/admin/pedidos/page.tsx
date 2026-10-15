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
  resumoDosItens,
  statusDoFiltro,
  urlDaExportacao,
  urlDoPainel,
  urlDoPedidoAdmin,
} from '@/lib/conta/painel';
import { leEntrega, leFrete, leStatus, POR_PAGINA, reais } from '@/lib/conta/pedidos';
import { ehTipoPosVenda, NOME_DO_TIPO } from '@/lib/conta/pos-venda';
import { formataDiaHora } from '@/lib/datas';
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

type Busca = Promise<Record<string, string | string[] | undefined>>;

/** Quantas solicitacoes abertas o topo do painel lista (#379). */
const SOLICITACOES_NO_TOPO = 10;

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
 * Os itens entraram na #345 — nome, tamanho e quantidade, e so: e o que o
 * dono separa da prateleira. Vem embutidos na mesma ida, sem N+1.
 */
const COLUNAS =
  'id, numero, status, criado_em, total_centavos, frete_centavos, frete_servico, frete_prazo_dias, entrega_nome, entrega_cep, entrega_logradouro, entrega_numero, entrega_complemento, entrega_bairro, entrega_cidade, entrega_uf, order_items(nome, tamanho, quantidade)';

/**
 * As solicitacoes de pos-venda abertas (#379), as mais antigas primeiro: sao
 * as que esperam ha mais tempo. O total vem do `count` — numa tabela pequena,
 * pelo indice parcial das abertas, e nao na de pedidos —, e a lista mostra
 * ate dez.
 */
function solicitacoesAbertas(admin: ReturnType<typeof clienteAdmin>) {
  return admin
    .from('solicitacoes_pos_venda')
    .select('id, tipo, protocolo, criado_em, order_id, orders(numero)', { count: 'exact' })
    .is('resolvida_em', null)
    .order('criado_em', { ascending: true })
    .limit(SOLICITACOES_NO_TOPO);
}

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

  // As tres idas ao banco em paralelo: a pagina, os contadores e as
  // solicitacoes de pos-venda abertas (#379).
  const [lista, contados, abertas] = await Promise.all([
    consulta
      .order('criado_em', { ascending: false })
      // Desempate, como na lista do cliente: sem ele um pedido na fronteira
      // das paginas aparece duas vezes ou some.
      .order('numero', { ascending: false })
      // Uma linha a mais do que cabe: se ela voltar, existe proxima pagina.
      .range(inicio, inicio + POR_PAGINA),
    admin.rpc('conta_pedidos_por_status'),
    solicitacoesAbertas(admin),
  ]);

  if (lista.error) console.warn('[admin] lista indisponivel:', lista.error.code);
  const pedidos = (lista.data ?? []).slice(0, POR_PAGINA);
  const temMais = (lista.data?.length ?? 0) > POR_PAGINA;

  // Sem a RPC (migration ainda nao aplicada, banco fora do ar) a lista
  // continua: os numeros somem dos filtros, e so.
  let contagem: Contagem | null = null;
  if (contados.error) console.warn('[admin] contagem indisponivel:', contados.error.code);
  else contagem = montaContagem(contados.data ?? []);

  // Sem a tabela (migration ainda nao aplicada) ou com o banco fora, o bloco
  // some e o resto do painel continua, como a contagem acima.
  if (abertas.error) console.warn('[admin] solicitacoes indisponiveis:', abertas.error.code);
  const solicitacoes = abertas.error ? null : (abertas.data ?? []);
  const totalAbertas = abertas.count ?? solicitacoes?.length ?? 0;

  // Link velho ou digitado na mao. A pagina 1 de cada filtro sempre existe.
  if (pedidos.length === 0 && pagina > 1) redirect(urlDoPainel(filtro));

  return (
    <>
      {/* O que os clientes pediram pelo site e ainda espera a loja (#379):
          cancelar, desistir, trocar, defeito. Em cima de tudo, porque e
          prazo correndo. Zero tambem aparece: e a resposta de "tem alguma
          coisa para eu ver?". */}
      {solicitacoes ? (
        <section className="admin-solicitacoes" aria-labelledby="admin-solicitacoes">
          <h2 id="admin-solicitacoes">
            Pedidos de clientes abertos <span className="admin-filtro-n">{totalAbertas}</span>
          </h2>
          {solicitacoes.length > 0 ? (
            <ul>
              {solicitacoes.map((s) => (
                <li key={s.id}>
                  <a href={urlDoPedidoAdmin(s.order_id)}>
                    Pedido #{s.orders?.numero ?? '?'} ·{' '}
                    {ehTipoPosVenda(s.tipo) ? NOME_DO_TIPO[s.tipo] : s.tipo} · {s.protocolo}
                  </a>{' '}
                  <time dateTime={s.criado_em}>{formataDiaHora(s.criado_em)}</time>
                </li>
              ))}
            </ul>
          ) : null}
          {totalAbertas > solicitacoes.length ? (
            <p className="detalhe-nota">Mostrando as {solicitacoes.length} mais antigas.</p>
          ) : null}
        </section>
      ) : null}

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

      {/* O filtro aberto, inteiro, em planilha (#345). `download`: o arquivo
          vem com Content-Disposition, e o atributo so evita que um navegador
          teimoso abra o CSV como texto na aba. */}
      <p className="admin-exportar">
        <a href={urlDaExportacao(filtro)} className="auth-link" download>
          Exportar CSV
        </a>
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
                      {/* Para o detalhe do dono (#345). O do cliente filtra por
                          `user_id`, e dava 404 em todo pedido que nao era
                          dele. */}
                      <a href={urlDoPedidoAdmin(p.id)}>Pedido #{p.numero}</a>
                    </h2>
                    <Selo rotulo={rotulo} tom={tom} />
                  </div>

                  <p className="pedido-data">
                    <time dateTime={p.criado_em}>{formataDiaHora(p.criado_em)}</time>
                    {p.entrega_nome ? ` · ${p.entrega_nome}` : ''}
                    {p.entrega_cidade ? ` · ${p.entrega_cidade}/${p.entrega_uf ?? ''}` : ''}
                  </p>

                  {/* O que separar da prateleira (#345). */}
                  {p.order_items.length > 0 ? (
                    <p className="admin-itens">{resumoDosItens(p.order_items)}</p>
                  ) : null}

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
