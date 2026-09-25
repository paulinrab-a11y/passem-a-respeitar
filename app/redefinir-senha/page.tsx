import type { Metadata } from 'next';
import { usuarioDaSessao } from '@/lib/supabase/servidor';
import Formulario from './Formulario';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Nova senha — Passem a Respeitar',
  robots: { index: false, follow: false },
};

/**
 * Redefinicao de senha (Issue #32).
 *
 * O token do e-mail ja foi validado no servidor pelo callback, que o trocou
 * por uma sessao. Esta pagina so confere se a sessao existe: sem ela, nao ha
 * formulario — ha o caminho para pedir outro link. A acao confere de novo.
 *
 * Nao esta em `exigeSessao` nem em `ehRotaDeAuth` de proposito: sem sessao
 * a resposta certa e esta tela, nao o login; com sessao, e o formulario, nao
 * a conta.
 */
export default async function RedefinirSenha() {
  const usuario = await usuarioDaSessao();

  return (
    <main className="auth">
      <div className="auth-scan" aria-hidden="true" />
      <div className="auth-vinheta" aria-hidden="true" />

      <section className="auth-caixa">
        <a href="/entrar" className="auth-voltar">
          ← Entrar
        </a>

        <h1>Nova senha</h1>

        {usuario ? (
          <>
            <p className="auth-sub">Escolha uma senha que seja só sua.</p>
            <Formulario />
          </>
        ) : (
          <div className="auth-form" role="status">
            <p className="auth-sub">Esse link não vale mais</p>
            <p className="detalhe-nota">
              Ele vence em uma hora e só funciona uma vez. Peça outro e use o mais recente.
            </p>
            <a className="btn" href="/recuperar-senha">
              Pedir outro link
            </a>
          </div>
        )}
      </section>
    </main>
  );
}
