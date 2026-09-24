/**
 * Leitura das variaveis do Mercado Pago (Issue #108).
 *
 * Tres variaveis, e a diferenca entre elas e a coisa mais importante deste
 * arquivo:
 *
 *   NEXT_PUBLIC_MERCADOPAGO_PUBLIC_KEY   publica. Vai para o bundle de
 *                                        proposito: e ela que o Payment Brick
 *                                        usa DENTRO do navegador para
 *                                        tokenizar o cartao. So cria token —
 *                                        nao cobra, nao consulta, nao estorna.
 *
 *   MERCADOPAGO_ACCESS_TOKEN             segredo. E ela que cobra. Lida so em
 *   MERCADOPAGO_WEBHOOK_SECRET           servidor, nunca com prefixo
 *                                        NEXT_PUBLIC_.
 *
 * Os dois segredos NAO moram neste arquivo. Este aqui e importavel por client
 * component, e uma leitura de segredo aqui viraria segredo no bundle. Quem os
 * le e o modulo server-only que fala com a API.
 */

/**
 * Escrita por extenso, nao por variavel: o Next substitui
 * `process.env.NEXT_PUBLIC_X` por texto durante o build e so reconhece a forma
 * literal. `process.env[nome]` chega undefined no navegador.
 */
export function chavePublica(): string | null {
  return process.env.NEXT_PUBLIC_MERCADOPAGO_PUBLIC_KEY ?? null;
}

/**
 * Centavos para o numero que o Brick espera.
 *
 * O Brick recebe valor em reais (`120.5`), e o banco guarda centavos inteiros.
 * A conversao acontece aqui, uma vez, e nao espalhada por quem monta o Brick.
 */
export function emReais(centavos: number): number {
  return centavos / 100;
}
