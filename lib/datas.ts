/**
 * Datas na tela, sempre em horario de Brasilia (#248).
 *
 * `Intl.DateTimeFormat` sem `timeZone` usa o fuso do processo, e na Vercel o
 * processo roda em UTC: um pedido das 21:30 de 05/10 saia como 06/10, 00:30
 * para o cliente e para o dono, e nao batia com o extrato do Mercado Pago.
 * Em desenvolvimento ninguem via, porque a maquina do dono esta em Brasilia.
 *
 * Todo formatador do site nasce aqui, com o fuso fixo, e um teste de fonte
 * (datas.test.ts) impede que uma tela nova crie o seu proprio e esqueca o
 * parametro. O fuso fixo vale tambem nos componentes de cliente: servidor e
 * navegador precisam escrever o mesmo texto, ou o React acusa divergencia de
 * hidratacao.
 *
 * O Brasil nao tem horario de verao desde 2019, entao America/Sao_Paulo e
 * UTC-3 o ano inteiro — mas o que vai no Intl e o nome da zona, nao o
 * deslocamento, para o dia em que isso mudar nao exigir deploy.
 */

const FUSO = 'America/Sao_Paulo';

/** O unico lugar do site que constroi um Intl.DateTimeFormat. */
function formatador(opcoes: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, ...opcoes });
}

const DIA = formatador({ day: '2-digit', month: '2-digit', year: 'numeric' });

const DIA_E_HORA = formatador({
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const DIA_SEM_ANO_E_HORA = formatador({
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

const POR_EXTENSO = formatador({ day: '2-digit', month: 'long', year: 'numeric' });

const MES_ABREVIADO_E_HORA = formatador({
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

/** `05/10/2026` — lista de pedidos e topo do detalhe. */
export function formataData(iso: string): string {
  return DIA.format(new Date(iso));
}

/** `05/10/2026, 21:30` — linha do tempo do pedido: "quando" inclui a que horas. */
export function formataDataHora(iso: string): string {
  return DIA_E_HORA.format(new Date(iso));
}

/** `05/10, 21:30` — painel do dono e vencimento do Pix, onde o ano e sempre o corrente. */
export function formataDiaHora(iso: string): string {
  return DIA_SEM_ANO_E_HORA.format(new Date(iso));
}

/** `05 de outubro de 2026` — "Na lista desde", na conta. */
export function formataDataPorExtenso(iso: string): string {
  return POR_EXTENSO.format(new Date(iso));
}

/** `05 de out., 21:30` — ultimo acesso de cada sessao. */
export function formataMesAbreviadoHora(iso: string): string {
  return MES_ABREVIADO_E_HORA.format(new Date(iso));
}

/** Um dia do calendario de Brasilia: para `<time dateTime>` e para a tela. */
export type Dia = {
  /** `2026-10-12`. Compara por texto: a ordem do texto e a dos dias. */
  iso: string;
  /** `12/10/2026`. */
  texto: string;
};

/**
 * O dia de Brasilia em que `iso` cai, mais `dias` dias corridos (#276).
 *
 * E a conta dos prazos do consumidor: entregue no dia 5, os sete dias do
 * arrependimento vao ate o dia 12 — o dia do recebimento nao conta, o ultimo
 * conta inteiro (Codigo Civil, art. 132). Somar 7 x 24 h ao instante da
 * entrega daria o dia certo so com o processo no fuso de Brasilia; na Vercel,
 * em UTC, uma entrega as 22 h ja comecaria a contar no dia seguinte.
 *
 * O dia sai do formatador de Brasilia, e a soma e feita no calendario, nao no
 * relogio. Meio-dia UTC e 09:00 em Brasilia: formatar esse instante devolve o
 * mesmo dia, sem escorregar para o vizinho.
 */
export function diaMaisDias(iso: string, dias: number): Dia {
  const [dia, mes, ano] = DIA.format(new Date(iso)).split('/').map(Number);
  const alvo = new Date(Date.UTC(ano, mes - 1, dia + dias, 12));
  return { iso: alvo.toISOString().slice(0, 10), texto: DIA.format(alvo) };
}
