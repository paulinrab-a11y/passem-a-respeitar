/**
 * CEP, sem schema (#353).
 *
 * Separado de endereco.ts porque o navegador tambem mostra CEP (a cotacao do
 * frete na home e no checkout), e endereco.ts importa o zod. Funcao pura aqui
 * nao arrasta biblioteca nenhuma para o bundle do cliente.
 */

/**
 * `01310-100`, `01310 100` e `01310100` sao o mesmo CEP. O banco guarda so
 * digitos para nao precisar decidir isso de novo em cada consulta.
 */
export function soDigitos(bruto: string): string {
  return bruto.replace(/\D/g, '');
}

/** `01310100` vira `01310-100`, para a tela. */
export function cepLegivel(cep: string): string {
  return /^\d{8}$/.test(cep) ? `${cep.slice(0, 5)}-${cep.slice(5)}` : cep;
}
