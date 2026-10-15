/**
 * Por quanto tempo um pedido espera o pagamento (#298, achado #25 da auditoria).
 *
 * O pedido guarda o preco e o frete do dia em que nasceu. Sem prazo, "Pagar
 * agora" ficava aberto para sempre: o dono sobe o preco, o Melhor Envio
 * reajusta, e um pedido de meses atras ainda era pago pelo valor antigo, com
 * um frete abaixo do que a etiqueta vai custar. E, desde a #296, o pedido nao
 * pago segura a peca no estoque ate alguem cancela-lo.
 *
 * 48 horas e o padrao proposto na #298: Pix e cartao confirmam na hora, e
 * dois dias cobrem quem deixou para pagar no dia seguinte. Quem volta depois
 * faz um pedido novo, com o preco e o frete de agora. O dono pode trocar o
 * numero aqui: a tela, a cobranca e o cron que cancela leem todos daqui.
 *
 * Sem `server-only`: o mapper da tela de pedidos tambem le isto.
 */
export const VALIDADE_DO_PEDIDO_MS = 48 * 60 * 60 * 1000;

/**
 * Ate quando o pedido aceita pagamento, em ISO. `null` com data ilegivel: a
 * tela deixa de mostrar o prazo, em vez de quebrar por um `RangeError`.
 */
export function pagarAte(criadoEm: string): string | null {
  const nascido = Date.parse(criadoEm);
  if (!Number.isFinite(nascido)) return null;

  return new Date(nascido + VALIDADE_DO_PEDIDO_MS).toISOString();
}

/**
 * O prazo para pagar acabou. Data ilegivel nao expira: `criado_em` vem do
 * banco, `not null`, e um texto torto aqui seria bug nosso — que nao pode
 * virar pedido cancelado.
 */
export function expirou(criadoEm: string, agoraMs = Date.now()): boolean {
  const nascido = Date.parse(criadoEm);

  return Number.isFinite(nascido) && agoraMs - nascido >= VALIDADE_DO_PEDIDO_MS;
}

/** O Mercado Pago nao aceita Pix com vencimento abaixo de 30 minutos. */
export const VALIDADE_MINIMA_DO_PIX_MS = 30 * 60 * 1000;

/** O vencimento padrao do Pix no provedor. Mais que isso nao se pede. */
const VALIDADE_MAXIMA_DO_PIX_MS = 24 * 60 * 60 * 1000;

/**
 * Por quanto tempo o Pix novo fica pagavel, em duracao ISO 8601 (`PT5H12M`),
 * que e o formato do `expiration_time` da Orders API.
 *
 * Sem isto o provedor dava 24 horas a qualquer Pix: um aberto perto do fim do
 * prazo continuava pagavel um dia depois de o pedido vencer, pelo preco e o
 * frete antigos, e a tela mostrava dois horarios que nao batiam. Aqui o Pix
 * vence junto com o pedido (ou antes, com o teto de 24 h), arredondado para
 * baixo no minuto.
 *
 * `null` quando falta menos que o minimo do provedor: um Pix desses so
 * existiria vencendo depois do pedido, entao nao se abre.
 */
export function validadeDoPix(criadoEm: string, agoraMs = Date.now()): string | null {
  const nascido = Date.parse(criadoEm);
  if (!Number.isFinite(nascido)) return null;

  const restante = Math.min(nascido + VALIDADE_DO_PEDIDO_MS - agoraMs, VALIDADE_MAXIMA_DO_PIX_MS);
  if (restante < VALIDADE_MINIMA_DO_PIX_MS) return null;

  const minutos = Math.floor(restante / 60_000);
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;

  return `PT${horas ? `${horas}H` : ''}${resto ? `${resto}M` : ''}`;
}
