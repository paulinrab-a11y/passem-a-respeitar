import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { JANELA_MINUTOS } from '@/lib/conta/reautenticacao';
import { ENTRAR } from '@/lib/rotas';
import { usuarioDaSessao } from '@/lib/supabase/servidor';
import ExcluirConta from './ExcluirConta';
import { minhasSessoes } from './lista-sessoes';
import Sessoes from './Sessoes';
import TrocarEmail from './TrocarEmail';
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

  const sessoes = await minhasSessoes();

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

        {/* `new_email` vem do Supabase, conferido no servidor: a tela de troca
            pendente nao depende de nada que o navegador afirme (#36). */}
        <TrocarEmail atual={usuario.email ?? ''} pendente={usuario.new_email || null} />

        <Sessoes sessoes={sessoes} janelaMinutos={JANELA_MINUTOS} />

        <ExcluirConta email={usuario.email ?? ''} />
      </section>
    </main>
  );
}
