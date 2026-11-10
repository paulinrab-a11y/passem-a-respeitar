import { formataDiaDoCalendario } from './datas';

/**
 * O lancamento da vez, num lugar so.
 *
 * A data ficou em sigilo ate o pre-save (#269); com ele, virou publica por
 * decisao do dono (26/10/2026). O single Blick foi o lancamento da vez ate
 * sair (#406); desde a #412 e o proprio EP, com o pre-save do album.
 * `EP_E_O_LANCAMENTO` vale sozinho, e o JSON-LD poe a data no EP.
 *
 * Daqui saem a linha da home, o JSON-LD, o /llms.txt e o concierge. Os testes
 * de cada um conferem que nenhum escreve a data a mao.
 */

/** O nome do EP, o mesmo do site e do JSON-LD. */
const NOME_DO_EP = 'Passem a Respeitar';

/** O que sai na data abaixo: o EP (antes, o single Blick). */
export const NOME_DO_LANCAMENTO: string = NOME_DO_EP;

/** Dia do lancamento, no calendario de Brasilia (ISO, sem hora). */
export const DATA_DE_LANCAMENTO = '2026-11-20';

/** O lancamento da vez e o proprio EP? Sim desde a #412. */
export const EP_E_O_LANCAMENTO = NOME_DO_LANCAMENTO === NOME_DO_EP;

/** `20.11` — a linha curta acima do pre-save, na home. */
export const LANCAMENTO_CURTO = formataDiaDoCalendario(DATA_DE_LANCAMENTO, 'curto');

/** `20 de novembro de 2026` — texto corrido (concierge, /llms.txt). */
export const LANCAMENTO_POR_EXTENSO = formataDiaDoCalendario(DATA_DE_LANCAMENTO, 'extenso');

/**
 * O lancamento em uma frase, para o concierge e o /llms.txt: "o EP, em 20 de
 * novembro de 2026" agora; "o single X, em ..." quando for um single.
 */
export const LANCAMENTO_EM_FRASE = EP_E_O_LANCAMENTO
  ? `o EP, em ${LANCAMENTO_POR_EXTENSO}`
  : `o single ${NOME_DO_LANCAMENTO}, em ${LANCAMENTO_POR_EXTENSO}`;
