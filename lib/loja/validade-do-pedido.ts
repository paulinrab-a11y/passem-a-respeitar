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
