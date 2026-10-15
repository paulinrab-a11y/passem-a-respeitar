/**
 * Por que o cartao foi recusado, em portugues (Issue #365).
 *
 * Antes, toda recusa dizia "O pagamento nao foi aprovado. Voce pode tentar de
 * novo." — e a pessoa tentava o mesmo cartao, com o mesmo CVV errado, ate
 * esbarrar no limite. O Mercado Pago diz o motivo no `status_detail`, que ja
 * ia para `pagamentos.provedor_status_detail`; aqui ele vira uma frase util.
 *
 * Tres regras:
 *
 *   - So texto deste mapa sai para o navegador. O `status_detail` e o codigo
 *     cru nunca saem: sao vocabulario do provedor, e uma mensagem montada
 *     com o que veio de fora e o primeiro passo para mostrar o que nao devia.
 *   - Toda frase oferece o Pix. Cartao recusado nao e pedido perdido, e o Pix
 *     nao passa pela analise do banco do cartao.
 *   - Codigo que nao esta no mapa vira a frase generica, e nao um palpite.
 *
 * Os nomes vem nas duas formas: `cc_rejected_*`, como a Payments API (e a
 * documentacao de cartoes de teste) escreve, e sem o prefixo, que e como a
 * Orders API devolve parte deles. Os da Orders API que tem nome proprio
 * (`required_call_for_authorize`, `max_attempts_exceeded`,
 * `rejected_other_reason`, `bad_filled_card_data`) apontam para a mesma
 * frase. Map, e nao objeto literal: a chave vem de fora (ver
 * estado-do-pagamento.ts).
 */

const PIX = 'ou pague com Pix';

const FRASES = {
  cvv: `O código de segurança não confere. Confira os 3 ou 4 dígitos no verso do cartão e tente de novo, ${PIX}.`,
  validade: `A validade do cartão não confere. Confira o mês e o ano e tente de novo, ${PIX}.`,
  numero: `O número do cartão não confere. Confira e tente de novo, ${PIX}.`,
  dados: `Algum dado do cartão não confere. Confira o nome do titular, o CPF e os dados do cartão, ${PIX}.`,
  limite: `O cartão não tem limite para este valor. Tente outro cartão ${PIX}.`,
  autorizar: `O banco do cartão pediu para você autorizar esta compra. Autorize pelo app ou telefone do banco e tente de novo, ${PIX}.`,
  bloqueado: `Este cartão está bloqueado ou ainda não foi ativado. Fale com o banco, use outro cartão ${PIX}.`,
  duplicado: `Um pagamento igual a este acabou de ser feito. Confira o pedido em Meus pedidos antes de tentar de novo, ${PIX}.`,
  risco: `O pagamento foi recusado pela análise de segurança do Mercado Pago. Tente outro cartão ${PIX}.`,
  tentativas: `Este cartão passou do número de tentativas permitidas. Use outro cartão ${PIX}.`,
  banco: `O banco do cartão recusou o pagamento. Tente outro cartão ${PIX}.`,
  naoAceito: `Este cartão não pode ser usado aqui. Tente outro cartão ${PIX}.`,
} as const;

/** A frase de quando o provedor nao disse o motivo, ou disse um que nao esta no mapa. */
export const RECUSA_GENERICA = `O pagamento não foi aprovado. Tente de novo, com outro cartão ${PIX}.`;

const MAPA = new Map<string, string>([
  ['bad_filled_security_code', FRASES.cvv],
  ['bad_filled_date', FRASES.validade],
  ['bad_filled_card_number', FRASES.numero],
  ['bad_filled_other', FRASES.dados],
  ['bad_filled_card_data', FRASES.dados],
  ['insufficient_amount', FRASES.limite],
  ['call_for_authorize', FRASES.autorizar],
  ['required_call_for_authorize', FRASES.autorizar],
  ['card_disabled', FRASES.bloqueado],
  ['duplicated_payment', FRASES.duplicado],
  ['high_risk', FRASES.risco],
  ['max_attempts', FRASES.tentativas],
  ['max_attempts_exceeded', FRASES.tentativas],
  ['other_reason', FRASES.banco],
  ['rejected_other_reason', FRASES.banco],
  ['rejected_by_issuer', FRASES.banco],
  ['blacklist', FRASES.naoAceito],
]);

/**
 * A frase para um `status_detail`. Sempre uma das frases fixas acima: o
 * argumento so escolhe qual.
 */
export function recadoDaRecusa(statusDetail: string | null | undefined): string {
  if (typeof statusDetail !== 'string') return RECUSA_GENERICA;

  const chave = statusDetail
    .trim()
    .toLowerCase()
    .replace(/^cc_rejected_/, '');
  return MAPA.get(chave) ?? RECUSA_GENERICA;
}
