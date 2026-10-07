import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import GuiaDeTamanhos from '@/app/_ui/GuiaDeTamanhos';
import { reais } from '@/lib/conta/pedidos';
import { guiaDeTamanhos, orcamento } from '@/lib/loja/catalogo';
import { esquemaItemDoCarrinho } from '@/lib/loja/precos';
import { ENTRAR } from '@/lib/rotas';
import { usuarioDaSessao } from '@/lib/supabase/servidor';
import Entrega from './Entrega';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Finalizar compra — Passem a Respeitar',
  robots: { index: false, follow: false },
};

/**
 * Checkout (Issue #106).
 *
 * Server Component. A URL carrega ESCOLHA — produto, tamanho, quantidade — e
 * todo numero na tela vem do `orcamento()`, que le o catalogo. Ninguem manda
 * preco para ca, e nao ha o que conferir.
 *
 * O frete depende do CEP, que so existe depois de a pessoa digitar (#199).
 * Por isso o resumo de cima para no subtotal, e o frete e o total moram no
 * formulario de entrega, junto do CEP.
 *
 * O middleware ja barra quem nao tem sessao (`exigeSessao` inclui /checkout
 * desde esta Issue), e a checagem aqui e a segunda, pelo mesmo motivo da #29.
 */
export default async function Checkout({
  searchParams,
}: {
  searchParams: Promise<{ p?: string; tam?: string; q?: string }>;
}) {
  if (!(await usuarioDaSessao())) redirect(ENTRAR);

  const { p, tam, q } = await searchParams;

  // A URL vem de fora, entao e afirmacao e nao fato — mesma regra do `next` em
  // rotas.ts e do `?p=` da #41.
  const item = esquemaItemDoCarrinho.safeParse({
    slug: p,
    tamanho: tam || null,
    quantidade: Number(q ?? 1),
  });

  const conta = item.success ? await orcamento([item.data]) : null;

  if (!item.success || !conta?.ok) {
    return (
      <main className="auth conta">
        <div className="auth-scan" aria-hidden="true" />
        <div className="auth-vinheta" aria-hidden="true" />
        <section className="auth-caixa conta-caixa">
          <a href="/#merch" className="auth-voltar">
            ← Merch
          </a>
          <h1>Finalizar</h1>
          <div className="pedidos-vazio">
            <p className="pedidos-vazio-titulo">Não consegui montar este pedido.</p>
            <p>
              O produto pode ter saído do ar ou o endereço pode estar incompleto. Escolha de novo na
              loja.
            </p>
            <a className="btn" href="/#merch">
              Ver a merch
            </a>
          </div>
        </section>
      </main>
    );
  }

  const linha = conta.linhas[0];
  // O guia (#206) tambem aqui: e a ultima chance de trocar o tamanho antes de
  // pagar, e trocar depois custa frete duas vezes.
  const guia = linha.tamanho ? await guiaDeTamanhos(linha.produtoSlug) : null;

  return (
    <main className="auth conta">
      <div className="auth-scan" aria-hidden="true" />
      <div className="auth-vinheta" aria-hidden="true" />

      <section className="auth-caixa checkout-caixa">
        <a href="/#merch" className="auth-voltar">
          ← Merch
        </a>
        <h1>Finalizar</h1>

        <section className="detalhe-bloco">
          <h2>Seu pedido</h2>

          <ul className="pedido-itens">
            <li>
              <span className="pedido-item-nome">{linha.nome}</span>
              <span className="pedido-item-detalhe">
                {linha.tamanho ? `tam. ${linha.tamanho} · ` : ''}
                {linha.quantidade} × {reais(linha.precoUnitarioCentavos)}
              </span>
            </li>
          </ul>
          {guia ? (
            <p className="guia-no-checkout">
              <GuiaDeTamanhos linhas={guia} produto={linha.nome} />
              <a href={`/#merch`} className="auth-link">
                Trocar o tamanho
              </a>
            </p>
          ) : null}

          <dl className="resumo">
            <div>
              <dt>Subtotal</dt>
              <dd>{reais(conta.subtotalCentavos)}</dd>
            </div>
          </dl>
        </section>

        <section className="detalhe-bloco">
          <h2>Entrega</h2>
          {/* #197: a camiseta e fabricada depois do pedido. Quem paga precisa
              saber do prazo antes de pagar, e nao depois. */}
          <p className="entrega-prazo">
            A camiseta é fabricada depois do pedido. A entrega leva pelo menos 30 dias.
          </p>

          <Entrega
            slug={linha.produtoSlug}
            tamanho={linha.tamanho}
            quantidade={linha.quantidade}
            subtotalCentavos={conta.subtotalCentavos}
          />
        </section>
      </section>
    </main>
  );
}
