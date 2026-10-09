/**
 * A data de lancamento do EP (Issue #269).
 *
 * Ela aparece em dois lugares que o visitante ve na mesma visita: o card do
 * link compartilhado (description, Open Graph e Twitter, em app/layout.tsx) e
 * a resposta do concierge (lib/concierge/prompt.ts). Escrita a mao em cada
 * um, divergiu: o card dizia 20.11.2026 e o concierge negava que houvesse
 * data.
 *
 * A fonte da verdade e o AGENTS.md; o teste confere que ele e o README dizem
 * a mesma data. Mudou a data, muda aqui e nos dois documentos, no mesmo PR.
 */
export const LANCAMENTO = {
  /** Como o card do link escreve, no mesmo formato do site estatico original. */
  curto: '20.11.2026',
  /** Como o concierge fala. */
  porExtenso: '20 de novembro de 2026',
} as const;
