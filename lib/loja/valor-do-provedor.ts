/**
 * Quanto a ordem vale no provedor, e se e o que cobramos (#350).
 *
 * O webhook e a conciliacao perguntam o estado ao provedor, e "aprovado" la
 * virava `pago` aqui sem olhar o valor. A ordem e criada pelo nosso servidor
 * com o total do banco, entao no caminho normal os dois batem. Conferir fecha
 * o caminho anormal: uma ordem com o mesmo `external_reference` e outro
 * valor, um pagamento parcial, uma moeda que nao e a nossa. Nesses casos o
 * pedido nao vira `pago` e o dono e avisado.
 *
 * Puro, sem rede, e fora de orders-api.ts de proposito: os testes do webhook
 * trocam aquele modulo inteiro, e esta regra tem que valer neles tambem.
 */

/** O que o provedor diz sobre dinheiro, ja em centavos. `null` = nao veio. */
export type ValorDoProvedor = {
  totalCentavos: number | null;
  pagoCentavos: number | null;
  moeda: string | null;
};

/** Ate 9 digitos inteiros e ate 2 decimais: "14.38", "14.4", "14". */
const DECIMAL = /^(\d{1,9})(?:\.(\d{1,2}))?$/;

/**
 * "14.38" em 1438, sem passar por float: `parseFloat("14.38") * 100` da
 * 1437.9999999999998, e um `Math.floor` esquecido vira um centavo de
 * diferenca que reprovaria pagamento bom. Numero tambem e aceito, pelo texto
 * dele. Qualquer outra coisa (negativo, virgula, tres decimais, notacao
 * cientifica) e `null`: valor que nao se le nao confere.
 */
export function centavosDaApi(valor: unknown): number | null {
  const texto = typeof valor === 'number' && Number.isFinite(valor) ? String(valor) : valor;
  if (typeof texto !== 'string') return null;

  const m = DECIMAL.exec(texto.trim());
  if (!m) return null;

  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
}

export function moedaDaApi(valor: unknown): string | null {
  return typeof valor === 'string' && valor.trim() ? valor.trim().toUpperCase() : null;
}

/**
 * O provedor confirma exatamente `esperadoCentavos`, em real?
 *
 * - O total da ordem tem que vir e ser igual. Sem total nao ha o que conferir,
 *   e falta de prova nao vira pago.
 * - O valor pago do pagamento, quando vem, tambem: pagamento parcial nao paga
 *   o pedido inteiro.
 * - A moeda, quando vem, tem que ser BRL. Quando nao vem, vale a da conta,
 *   que e brasileira e so recebe em real.
 */
export function valorConfere(valor: ValorDoProvedor | undefined, esperadoCentavos: number) {
  if (!valor || valor.totalCentavos === null) return false;
  if (valor.totalCentavos !== esperadoCentavos) return false;
  if (valor.pagoCentavos !== null && valor.pagoCentavos !== esperadoCentavos) return false;
  return valor.moeda === null || valor.moeda === 'BRL';
}
