import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { ENTRAR } from '@/lib/rotas';
import { usuarioDaSessao } from '@/lib/supabase/servidor';
import TrocarSenha from './TrocarSenha';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Segurança — Passem a Respeitar',
  robots: { index: false, follow: false },
};

export default async function Seguranca() {
  // Segunda verificacao, depois do middleware (#29).
  const usuario = await usuarioDaSessao();
  if (!usuario) redirect(ENTRAR);

  return (
    <main className="auth conta">
      <div className="auth-scan" aria-hidden="true" />
      <div className="auth-vinheta" aria-hidden="true" />

      <section className="auth-caixa conta-caixa">
        <a href="/conta" className="auth-voltar">
          ← Conta
        </a>
        <h1>Segurança</h1>
        <p className="auth-sub">Trocar senha</p>

        <TrocarSenha />
      </section>
    </main>
  );
}
