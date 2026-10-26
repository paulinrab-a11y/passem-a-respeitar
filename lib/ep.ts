import { formataDiaDoCalendario } from './datas';

/**
 * O lancamento do EP, num lugar so.
 *
 * A data ficou em sigilo ate o pre-save (#269). O pre-save saiu em 26/10/2026
 * e, com ele, a data virou publica por decisao do dono. Daqui saem a linha da
 * home, o JSON-LD, o /llms.txt e o concierge: mudou a data, muda so aqui. Os
 * testes de cada um desses lugares conferem que nenhum escreve a data a mao.
 */

/** Dia do lancamento, no calendario de Brasilia (ISO, sem hora). */
export const DATA_DE_LANCAMENTO = '2026-11-20';

/** `20.11` — a linha curta acima do pre-save, na home. */
export const LANCAMENTO_CURTO = formataDiaDoCalendario(DATA_DE_LANCAMENTO, 'curto');

/** `20 de novembro de 2026` — texto corrido (concierge, /llms.txt). */
export const LANCAMENTO_POR_EXTENSO = formataDiaDoCalendario(DATA_DE_LANCAMENTO, 'extenso');
