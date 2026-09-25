import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { ehAdmin } from '@/lib/admin';
import { leStatus, reais } from '@/lib/conta/pedidos';
import { ehStatusPedido } from '@/lib/loja/status-do-pedido';
import { ENTRAR } from '@/lib/rotas';
import { clienteAdmin } from '@/lib/supabase/admin';
import { usuarioDaSessao } from '@/lib/supabase/servidor';
import MudarStatus from './MudarStatus';

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

/** Os mais recentes bastam: pedido de meses atras ja chegou ou ja foi resolvido. */
const QUANTOS = 50;

/**
 * Tela administrativa de pedidos (Issue #43).
 *
 * Quem nao e administrador recebe 404, nao 403: a tela nao existe para essa
 * pessoa, e a diferenca entre "nao existe" e "existe mas nao e seu" ja e
 * informacao.
 *
 * Le com o client administrativo, porque a RLS — corretamente — so mostra a
 * cada um os proprios pedidos. E a unica tela do site que ve pedido alheio,
 * e por isso a checagem de papel vem antes de qualquer consulta.
 */
export default async function PedidosAdmin() {
  const usuario = await usuarioDaSessao();
  if (!usuario) redirect(ENTRAR);

  if (!ehAdmin({ email: usuario.email, emailVerificado: Boolean(usuario.email_confirmed_at) })) {
    notFound();
  }

  const { data } = await clienteAdmin()
    .from('orders')
    // O nome e a cidade sao o que se precisa para separar e enviar. O
    // endereco completo continua so no detalhe do dono e na etiqueta.
    .select(
      'id, numero, status, criado_em, total_centavos, entrega_nome, entrega_cidade, entrega_uf'
    )
    .order('criado_em', { ascending: false })
    .limit(QUANTOS);

  const pedidos = data ?? [];

  return (
    <main className="auth conta">
      <div className="auth-scan" aria-hidden="true" />
      <div className="auth-vinheta" aria-hidden="true" />

      <section className="auth-caixa conta-caixa">
        <a href="/conta" className="auth-voltar">
          ← Conta
        </a>
        <h1>Pedidos</h1>
        <p className="detalhe-nota">
          Os {QUANTOS} mais recentes. Cada mudança fica registrada com quem fez, quando e por quê.
        </p>

        {pedidos.length === 0 ? (
          <div className="pedidos-vazio">
            <p className="pedidos-vazio-titulo">Nenhum pedido ainda.</p>
          </div>
        ) : (
          <ul className="pedidos">
            {pedidos.map((p) => {
              const { rotulo, tom } = leStatus(p.status);
              return (
                <li key={p.id}>
                  <article className={tom}>
                    <div className="pedido-topo">
                      <h2>
                        <a href={`/conta/pedidos/${p.id}`}>Pedido #{p.numero}</a>
                      </h2>
                      <span className={`pedido-status ${tom}`}>{rotulo}</span>
                    </div>

                    <p className="pedido-data">
                      <time dateTime={p.criado_em}>{diaEHora.format(new Date(p.criado_em))}</time>
                      {p.entrega_nome ? ` · ${p.entrega_nome}` : ''}
                      {p.entrega_cidade ? ` · ${p.entrega_cidade}/${p.entrega_uf ?? ''}` : ''}
                    </p>

                    <p className="pedido-total">
                      <span>Total</span>
                      <strong>{reais(p.total_centavos)}</strong>
                    </p>

                    {ehStatusPedido(p.status) ? (
                      <MudarStatus pedido={p.id} status={p.status} />
                    ) : null}
                  </article>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
