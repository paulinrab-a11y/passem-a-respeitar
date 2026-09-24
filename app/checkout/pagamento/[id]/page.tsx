import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { meuPedido } from '@/app/conta/pedidos/[id]/busca-pedido';
import { pareceUuid } from '@/lib/conta/pedidos';
import { chavePublica, emReais } from '@/lib/loja/mercadopago';
import { ENTRAR } from '@/lib/rotas';
import { usuarioDaSessao } from '@/lib/supabase/servidor';
import Brick from './Brick';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Pagamento — Passem a Respeitar',
  robots: { index: false, follow: false },
};

/**
 * Tela de pagamento (Issue #108).
 *
 * Server Component. Le o pedido pela MESMA funcao da #42 — `meuPedido` — e
 * herda a garantia dela de graca: pedido de outra pessoa e pedido inexistente
 * respondem 404 identico, porque a consulta nao distingue os dois.
 *
 * O unico pedaco de cliente e o Brick.
 */
export default async function Pagamento({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!pareceUuid(id)) notFound();

  const resultado = await meuPedido(id);
  if (resultado.tipo === 'sem-sessao') redirect(ENTRAR);
  if (resultado.tipo === 'nao-achei') notFound();

  const { pedido } = resultado;
  const usuario = await usuarioDaSessao();
  const chave = chavePublica();

  return (
    <main className="auth conta">
      <div className="auth-scan" aria-hidden="true" />
      <div className="auth-vinheta" aria-hidden="true" />

      <section className="auth-caixa checkout-caixa">
        <a href={`/conta/pedidos/${id}`} className="auth-voltar">
          ← Pedido #{pedido.numero}
        </a>
        <h1>Pagamento</h1>

        <p className="detalhe-topo">
          <span className={`pedido-status ${pedido.tom}`}>{pedido.rotulo}</span>
          <strong className="pagamento-valor">{pedido.total}</strong>
        </p>

        <section className="detalhe-bloco">
          <h2>Como você prefere pagar</h2>

          {/* Falha fechada e com recado: sem a chave publica o Brick nao monta,
              e uma area vazia nao explica nada a quem esta tentando pagar. A
              leitura fica no servidor porque ele ja precisa decidir o que
              renderizar — ler nos dois lados seriam duas verdades. */}
          {chave ? (
            <Brick
              chavePublica={chave}
              valor={emReais(pedido.totalCentavos)}
              valorEscrito={pedido.total}
              email={usuario?.email ?? ''}
              pedido={id}
            />
          ) : (
            <p className="detalhe-nota">
              O pagamento está fora do ar no momento. Seu pedido está salvo — volte daqui a pouco.
            </p>
          )}
        </section>
      </section>
    </main>
  );
}
