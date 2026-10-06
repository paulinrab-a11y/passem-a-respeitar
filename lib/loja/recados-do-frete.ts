/**
 * O que a pessoa le quando o frete nao sai (#199, #205).
 *
 * Fora de qualquer arquivo `'use server'`, porque dois lugares leem: o
 * checkout e a ficha da camiseta na home. Nenhuma frase diz qual configuracao
 * falta — isso e do log.
 */
export const RECADOS_DO_FRETE: Record<string, string> = {
  'frete-cep-invalido': 'Confira o CEP: não encontrei esse endereço.',
  'frete-sem-servico': 'Os Correios não entregam nesse CEP por PAC nem por SEDEX.',
  'frete-servico-indisponivel': 'Esse tipo de envio não atende esse CEP. Escolha o outro.',
  'frete-fora-do-ar': 'Não consegui calcular o frete agora. Tente de novo em instantes.',
  'frete-sem-configuracao': 'O frete está indisponível no momento. Tente de novo mais tarde.',
  'frete-sem-medida': 'O frete está indisponível no momento. Tente de novo mais tarde.',
  'frete-limite': 'Muitas consultas de frete. Tente de novo em alguns minutos.',
};
