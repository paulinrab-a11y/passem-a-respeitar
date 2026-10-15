import type { Metadata } from 'next';
import { ehHashDeLink, ehTipoDeLink, type TipoDeLink } from '@/lib/conta/link-do-email';
import { continuarLink } from './acoes';
import Botao from './Botao';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Continuar — Passem a Respeitar',
  robots: { index: false, follow: false },
};

/**
 * A parada entre o link do e-mail e a sessao (#348).
 *
 * O GET desta pagina nao verifica nada: o token chega aqui so para voltar no
 * POST do botao (./acoes.ts). Quem abre o link sem querer — o verificador de
 * links do provedor, um toque num link que outra pessoa mandou — ve um botao
 * e para por aqui, sem sessao e sem gastar o token.
 *
 * Nao ha e-mail mascarado na tela: descobrir de quem e o link exigiria
 * verificar o token, e verificar e justamente o que o GET nao faz. O texto e
 * o mesmo para qualquer conta.
 */

const TEXTO: Record<TipoDeLink, { titulo: string; sub: string; botao: string }> = {
  recovery: {
    titulo: 'Nova senha',
    sub: 'Toque em continuar para escolher uma senha nova.',
    botao: 'Continuar',
  },
  signup: { titulo: 'Confirmar e-mail', sub: 'Falta um toque.', botao: 'Confirmar e-mail' },
  email: { titulo: 'Confirmar e-mail', sub: 'Falta um toque.', botao: 'Confirmar e-mail' },
  email_change: {
    titulo: 'Troca de e-mail',
    sub: 'Toque para confirmar o endereço novo.',
    botao: 'Confirmar troca',
  },
  magiclink: { titulo: 'Entrar', sub: 'Toque para entrar na sua conta.', botao: 'Entrar' },
  invite: { titulo: 'Convite', sub: 'Toque para aceitar o convite.', botao: 'Aceitar' },
};

export default async function Continuar({
  searchParams,
}: {
  searchParams: Promise<{ token_hash?: string; type?: string; next?: string }>;
}) {
  const { token_hash: tokenHash, type: tipo, next } = await searchParams;
  const valido = ehTipoDeLink(tipo) && ehHashDeLink(tokenHash);
  const texto = valido ? TEXTO[tipo] : null;

  return (
    <main className="auth">
      <div className="auth-scan" aria-hidden="true" />
      <div className="auth-vinheta" aria-hidden="true" />

      <section className="auth-caixa">
        <a href="/entrar" className="auth-voltar">
          ← Entrar
        </a>

        {valido && texto ? (
          <>
            <h1>{texto.titulo}</h1>
            <p className="auth-sub">{texto.sub}</p>
            <form action={continuarLink} className="auth-form">
              <input type="hidden" name="token_hash" value={tokenHash} />
              <input type="hidden" name="type" value={tipo} />
              {next && tipo !== 'recovery' ? (
                <input type="hidden" name="next" value={next} />
              ) : null}
              <Botao texto={texto.botao} />
              <p className="detalhe-nota">
                Se não foi você que pediu este e-mail, feche esta página. Nada muda na conta.
              </p>
            </form>
          </>
        ) : (
          <div className="auth-form" role="status">
            <h1>Link incompleto</h1>
            <p className="detalhe-nota">
              Abra o link do e-mail de novo, ou peça outro. Ele vence em uma hora e só funciona uma
              vez.
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
