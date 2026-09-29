import type { Metadata } from 'next';
import { headers } from 'next/headers';

export const metadata: Metadata = {
  title: 'Página não encontrada — Passem a Respeitar',
  robots: { index: false, follow: false },
};

/**
 * Pagina de nao encontrado (Issue #173).
 *
 * Serve a dois casos, e de proposito nao sabe qual dos dois e:
 *
 *   - endereco que nao existe
 *   - `notFound()` chamado por uma pagina — o pedido que nao existe ou que e
 *     de outra pessoa (#42, #160). Dizer "pedido nao encontrado" ali ja
 *     contaria que o endereco e de pedido.
 *
 * `await headers()` nao le nada. Esta aqui para a pagina ser montada a cada
 * pedido, e nao uma vez no build: a CSP pede um nonce novo por resposta, e
 * pagina de build nao tem nonce. Sem isto o navegador barrava TODOS os
 * scripts da pagina — treze erros no console, e nem o Sentry nem o Analytics
 * rodavam num 404.
 */
export default async function NaoEncontrada() {
  await headers();

  return (
    <main className="auth">
      <div className="auth-scan" aria-hidden="true" />
      <div className="auth-vinheta" aria-hidden="true" />

      <section className="auth-caixa">
        <a href="/" className="auth-voltar">
          ← Passem a Respeitar
        </a>

        <h1>Página não encontrada</h1>
        <p className="auth-sub">Erro 404</p>

        <div className="auth-form">
          <p className="detalhe-nota">Esse endereço não existe, ou não existe mais.</p>

          <a className="btn" href="/">
            Voltar ao início
          </a>

          <p className="auth-rodape">
            Procurando um pedido? <a href="/conta/pedidos">Meus pedidos</a>
          </p>
        </div>
      </section>
    </main>
  );
}
