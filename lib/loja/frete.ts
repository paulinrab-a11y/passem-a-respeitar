/**
 * Frete (Issue #99).
 *
 * Hoje o frete e R$ 0,00 — por decisao registrada, nao por esquecimento. A
 * politica final ainda nao existe, e inventar uma tabela de frete seria
 * inventar dado.
 *
 * O ponto deste arquivo e que `0` apareca UMA vez no projeto inteiro. Quando a
 * regra existir, muda o corpo desta funcao e mais nada: nem o checkout, nem o
 * calculo do total, nem a tela precisam saber que a regra mudou.
 *
 * Por isso duas escolhas que parecem exageradas para uma funcao que devolve
 * zero:
 *
 *   1. `async`. Calcular frete de verdade e consultar os Correios ou uma
 *      transportadora, e isso e uma ida a rede. Se a funcao nascesse sincrona,
 *      o dia da troca viraria um `await` novo em cada chamador — que e
 *      exatamente a refatoracao que este arquivo existe para evitar.
 *
 *   2. A entrada ja carrega o que uma regra real pediria: CEP, subtotal e
 *      numero de pecas. Quem chama ja entrega tudo; a funcao e que ainda nao
 *      usa.
 */

export type BaseDoFrete = {
  /** Soma dos produtos, em centavos. Regra de "frete gratis acima de X" le daqui. */
  subtotalCentavos: number;
  /** So digitos, ou null enquanto a pessoa nao informou. */
  cep?: string | null;
  /** Total de pecas. Peso e funcao disto, quando houver tabela. */
  pecas: number;
};

/** O unico `0` de frete do projeto. */
const SEM_COBRANCA = 0;

export async function calculaFrete(_base: BaseDoFrete): Promise<number> {
  return SEM_COBRANCA;
}
