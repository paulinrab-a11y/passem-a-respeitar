/**
 * Quem e administrador (Issue #43).
 *
 * O papel vive no SERVIDOR, numa variavel de ambiente — nunca numa coluna
 * que o cliente possa influenciar, nunca num campo de formulario. A lista e
 * de e-mails porque e o que o dono conhece; o id do Supabase ninguem decora.
 *
 * Duas condicoes, e as duas precisam valer:
 *   - o e-mail da sessao esta na lista
 *   - o e-mail foi VERIFICADO. Sem isso, quem cadastrasse o e-mail do dono
 *     antes dele — sem confirmar — seria administrador ate a confirmacao.
 *
 * Falha fechada: sem a variavel, ninguem e administrador.
 */

export type QuemPergunta = {
  email: string | null | undefined;
  emailVerificado: boolean;
};

function lista(): Set<string> {
  return new Set(
    (process.env.ADMIN_EMAILS ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
  );
}

export function ehAdmin({ email, emailVerificado }: QuemPergunta): boolean {
  if (!email || !emailVerificado) return false;
  return lista().has(email.trim().toLowerCase());
}
