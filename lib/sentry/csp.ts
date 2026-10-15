import { ambiente } from './opcoes';

/**
 * Para onde o navegador manda as violacoes de CSP (#316).
 *
 * A allowlist do Mercado Pago no proxy.ts saiu de medicao feita a mao. Se o
 * Brick passar a chamar um host novo, a violacao acontece no navegador de quem
 * esta pagando e, sem relatorio, ninguem fica sabendo. O Sentry ja recebe os
 * erros do site e tem um endpoint proprio para isso.
 *
 * A URL sai da DSN publica, a mesma que o SDK do navegador ja carrega, e nao
 * de uma variavel a mais: trocar de projeto no Sentry nao pode deixar a CSP
 * reportando para o projeto antigo em silencio. A chave da DSN e publica por
 * definicao — so permite ENVIAR evento, nunca ler.
 *
 * Formato documentado pelo Sentry:
 *   https://<host>/api/<projeto>/security/?sentry_key=<chave>
 * com `sentry_environment` para separar preview de producao no painel.
 *
 * DSN ausente ou malformada devolve null, e a CSP fica sem diretiva de
 * relatorio — exatamente como era antes.
 */
export function urlDeRelatorio(dsn: string | undefined): string | null {
  if (!dsn) return null;

  let url: URL;
  try {
    url = new URL(dsn);
  } catch {
    return null;
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;

  const chave = url.username;
  // O id do projeto e o ultimo pedaco do caminho; o que vem antes (Sentry
  // auto-hospedado atras de um prefixo) continua na frente de /api.
  const pedacos = url.pathname.split('/').filter(Boolean);
  const projeto = pedacos.pop();
  if (!chave || !projeto || !/^\d+$/.test(projeto)) return null;

  const prefixo = pedacos.length ? `/${pedacos.join('/')}` : '';
  const destino = new URL(`${url.protocol}//${url.host}${prefixo}/api/${projeto}/security/`);
  destino.searchParams.set('sentry_key', chave);
  destino.searchParams.set('sentry_environment', ambiente());
  return destino.toString();
}

/** Nome do grupo que `report-to` aponta e `Reporting-Endpoints` define. */
const GRUPO_CSP = 'csp-endpoint';

/**
 * As duas diretivas de relatorio, para o fim da politica.
 *
 * As duas, e nao uma: `report-uri` e o que Firefox e Safari entendem hoje;
 * `report-to` e o que o Chrome usa — e, quando ela existe, o Chrome ignora a
 * `report-uri`. Por isso `report-to` so vale junto do cabecalho
 * `Reporting-Endpoints` (ver `cabecalhoDeRelatorio`).
 */
export function diretivasDeRelatorio(url: string): string[] {
  return [`report-uri ${url}`, `report-to ${GRUPO_CSP}`];
}

/** Valor do cabecalho `Reporting-Endpoints` que define o grupo da CSP. */
export function cabecalhoDeRelatorio(url: string): string {
  return `${GRUPO_CSP}="${url}"`;
}
