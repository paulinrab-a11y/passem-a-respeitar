import { formataDiaDoCalendario } from './datas';

/**
 * O lancamento da vez, num lugar so.
 *
 * A data ficou em sigilo ate o pre-save (#269); com ele, virou publica por
 * decisao do dono (26/10/2026). O lancamento da vez e o single Blick (#406):
 * o pre-save e dele, e a data do EP so entra quando o Blick sair. Para trocar
 * para o EP, muda o nome e a data aqui — `EP_E_O_LANCAMENTO` passa a valer
 * sozinho e o JSON-LD poe a data no EP em vez de no single.
 *
 * Daqui saem a linha da home, o JSON-LD, o /llms.txt e o concierge. Os testes
 * de cada um conferem que nenhum escreve a data a mao.
 */

/** O nome do EP, o mesmo do site e do JSON-LD. */
export const NOME_DO_EP = 'Passem a Respeitar';

/** O que sai na data abaixo: o single agora, o EP depois. */
export const NOME_DO_LANCAMENTO: string = 'Blick';

/** Dia do lancamento, no calendario de Brasilia (ISO, sem hora). */
export const DATA_DE_LANCAMENTO = '2026-10-29';

/** O lancamento da vez e o proprio EP? Enquanto for o single, nao. */
export const EP_E_O_LANCAMENTO = NOME_DO_LANCAMENTO === NOME_DO_EP;

/** `29.10` — a linha curta acima do pre-save, na home. */
export const LANCAMENTO_CURTO = formataDiaDoCalendario(DATA_DE_LANCAMENTO, 'curto');

/** `29 de outubro de 2026` — texto corrido (concierge, /llms.txt). */
export const LANCAMENTO_POR_EXTENSO = formataDiaDoCalendario(DATA_DE_LANCAMENTO, 'extenso');

/**
 * O lancamento em uma frase, para o concierge e o /llms.txt: "o single Blick,
 * em 29 de outubro de 2026" agora; "o EP, em ..." quando for o EP.
 */
export const LANCAMENTO_EM_FRASE = EP_E_O_LANCAMENTO
  ? `o EP, em ${LANCAMENTO_POR_EXTENSO}`
  : `o single ${NOME_DO_LANCAMENTO}, em ${LANCAMENTO_POR_EXTENSO}`;
