import type { Metadata } from 'next';
import Formulario from './Formulario';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Criar conta — Passem a Respeitar',
  robots: { index: false, follow: false },
};

/**
 * Cadastro (Issue #30). O middleware ja manda quem tem sessao para a conta;
 * quem chega aqui nao tem.
 */
export default function CriarConta() {
  return (
    <main className="auth">
      <div className="auth-scan" aria-hidden="true" />
      <div className="auth-vinheta" aria-hidden="true" />

      <section className="auth-caixa">
        <a href="/" className="auth-voltar">
          ← Passem a Respeitar
        </a>

        <h1>Criar conta</h1>
        <p className="auth-sub">Para comprar e acompanhar seus pedidos.</p>

        <Formulario />
      </section>
    </main>
  );
}
