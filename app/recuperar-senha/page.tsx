import type { Metadata } from 'next';
import Formulario from './Formulario';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Recuperar senha — Passem a Respeitar',
  robots: { index: false, follow: false },
};

/**
 * Pedido de recuperacao (Issue #32). Quem tem sessao nao chega aqui: o
 * middleware manda para a conta, onde a troca de senha e outra tela.
 */
export default async function RecuperarSenha({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string }>;
}) {
  const { erro } = await searchParams;

  return (
    <main className="auth">
      <div className="auth-scan" aria-hidden="true" />
      <div className="auth-vinheta" aria-hidden="true" />

      <section className="auth-caixa">
        <a href="/entrar" className="auth-voltar">
          ← Entrar
        </a>

        <h1>Recuperar senha</h1>
        <p className="auth-sub">Mandamos um link para o seu e-mail.</p>

        {/* O callback volta para ca quando o link e velho, usado ou inventado. */}
        {erro === 'link' ? (
          <p className="auth-erro" role="alert">
            Esse link não vale mais. Peça outro abaixo.
          </p>
        ) : null}

        <Formulario />
      </section>
    </main>
  );
}
