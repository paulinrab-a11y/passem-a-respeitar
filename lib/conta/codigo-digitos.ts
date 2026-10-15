/**
 * Comprimento do codigo de confirmacao (#224). E uma configuracao do projeto
 * no Supabase (Authentication > Sign In / Providers > Email > "Email OTP
 * length"): producao esta em 8, e o config.toml local acompanha. Mudar la sem
 * mudar aqui faz o campo recusar o codigo que chegou — foi o que aconteceu em
 * 06/10/2026 com 6 aqui e 8 la.
 *
 * Modulo proprio (#353): o campo do codigo e componente de cliente, e importar
 * a constante de lib/esquemas.ts levava o zod inteiro para o navegador.
 */
export const CODIGO_DIGITOS = 8;
