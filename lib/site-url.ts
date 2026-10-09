import 'server-only';

/**
 * Endereco publico do site, para montar link que volta para ca (Issue #30).
 *
 * Os e-mails de recuperacao e de troca de e-mail carregam um link de retorno
 * (o de cadastro, desde a #227, traz so o codigo), e esse link precisa saber
 * onde o site esta:
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

/** Nome ou IP, com porta opcional. Nada de barra, arroba, espaco ou esquema. */
const HOST = /^(?:[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?|\[[0-9a-f:.]+\])(?::\d{1,5})?$/i;

/**
 * A origem por onde ESTE pedido chegou, para redirecionar de volta a ela (#168).
 *
 * Nao e `urlDoSite`: aquela responde "onde o site mora", e pode ser um
 * dominio fixo. Esta responde "por onde a pessoa entrou agora", que e onde o
 * navegador dela acabou de guardar o cookie de sessao. Redirecionar para
 * outro host, mesmo que seja o mesmo servidor, e chegar la sem cookie.
 *
 * `reserva` e a origem que o Next calculou. Na Vercel as duas coincidem. Sob
 * `next start`, num route handler, a do Next e sempre `localhost`, venha o
 * pedido pelo endereco que vier — e por isso que o cabecalho e consultado.
 *
 * O cabecalho escolhe so o HOST. O caminho continua sendo de quem chama, e
 * passa por `destinoSeguro`. E host de cabecalho nao e algo que um site de
 * fora consiga escolher pela vitima: numa navegacao, quem escreve o `Host` e
 * o navegador, com o endereco que a pessoa abriu. Valor que nao tenha cara de
 * host e ignorado.
 */
export function origemDoPedido(cabecalhos: Headers, reserva: string): string {
  const primeiro = (nome: string) => cabecalhos.get(nome)?.split(',')[0].trim();

  const host = primeiro('x-forwarded-host') ?? primeiro('host');
  if (!host || !HOST.test(host)) return reserva;

  const dito = primeiro('x-forwarded-proto');
  const esquema =
    dito === 'http' || dito === 'https' ? dito : new URL(reserva).protocol.slice(0, -1);

  return `${esquema}://${host.toLowerCase()}`;
}
