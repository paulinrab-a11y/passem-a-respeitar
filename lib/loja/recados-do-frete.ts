/**
 * O que a pessoa le quando o frete nao sai (#199, #205).
 *
 * Fora de qualquer arquivo `'use server'`, porque dois lugares leem: o
 * checkout e a ficha da camiseta na home. Nenhuma frase diz qual configuracao
 * falta — isso e do log.
 *
 * Nenhuma cita servico (#265): hoje so o SEDEX aparece, e prometer PAC, ou
 * mandar "escolher o outro" com um radio so na tela, e prometer o que a caixa
 * nao mostra. O servico recusado na criacao do pedido so acontece no
 * checkout, e la a caixa cota de novo sozinha — dai o "recalculamos".
 */
export const RECADOS_DO_FRETE: Record<string, string> = {
  'frete-cep-invalido': 'Confira o CEP: não encontrei esse endereço.',
  'frete-sem-servico': 'Os Correios não entregam nesse CEP.',
  'frete-servico-indisponivel':
    'Esse envio não atende mais esse CEP. Recalculamos o frete, confira e finalize de novo.',
  'frete-fora-do-ar': 'Não consegui calcular o frete agora. Tente de novo em instantes.',
  'frete-sem-configuracao': 'O frete está indisponível no momento. Tente de novo mais tarde.',
  'frete-sem-medida': 'O frete está indisponível no momento. Tente de novo mais tarde.',
  'frete-limite': 'Muitas consultas de frete. Tente de novo em alguns minutos.',
};

/**
 * Motivos que passam sozinhos (#240): a pessoa nao tem o que corrigir, so
 * esperar — e para eles a tela oferece "Tentar de novo". CEP que nao existe e
 * trecho sem servico ficam de fora: repetir a consulta devolve a mesma recusa,
 * e o botao prometeria o que nao vem.
 */
export const MOTIVOS_TRANSITORIOS: ReadonlySet<string> = new Set([
  'frete-fora-do-ar',
  'frete-sem-configuracao',
  'frete-sem-medida',
  'frete-limite',
]);
