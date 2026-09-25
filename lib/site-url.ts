import 'server-only';

/**
 * Endereco publico do site, para montar link que volta para ca (Issue #30).
 *
 * Os e-mails de confirmacao e de recuperacao carregam um link de retorno, e
 * esse link precisa saber onde o site esta:
 *
 *   1. `NEXT_PUBLIC_SITE_URL`, quando definida — e o dominio final (#54).
 *      Trocar de dominio e trocar esta variavel, nada mais.
 *   2. Senao, o host do request. E o que faz um preview da Vercel mandar o
 *      link de volta para o proprio preview, e nao para producao.
 *
 * O host do request vem de cabecalho, e cabecalho e afirmacao. Aqui isso e
 * aceitavel por dois motivos: a Vercel reescreve `host` e
 * `x-forwarded-proto` antes de chegar em nos, e o Supabase so redireciona
 * para URL que esteja na lista dele — um host forjado nem sairia no e-mail.
 */
export function urlDoSite(cabecalhos: Headers): string {
  const fixa = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, '');
  if (fixa) return fixa;

  const host = cabecalhos.get('x-forwarded-host') ?? cabecalhos.get('host');
  if (!host) return 'http://localhost:3000';

  const proto =
    cabecalhos.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

/** O ponto de volta dos links de e-mail, com o destino final embutido. */
export function urlDeRetorno(cabecalhos: Headers, next: string): string {
  const u = new URL('/auth/callback', urlDoSite(cabecalhos));
  u.searchParams.set('next', next);
  return u.toString();
}
