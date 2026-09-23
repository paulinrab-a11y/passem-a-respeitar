/**
 * Linha do tempo do pedido (Issue #42).
 *
 * Montada a partir da trilha que o trigger da #18 escreve em
 * `order_status_history` — nunca inventada a partir do status atual. A regra e
 * simples e vale a pena ser explicita: se o banco nao registrou, a tela nao
 * afirma. Um "Pagamento confirmado em 20/09" deduzido de um status `enviado`
 * seria uma data que ninguem mediu.
 *
 * Funcao pura, sem banco e sem React: e aqui que moram as decisoes que dariam
 * errado em silencio.
 */

/**
 * As cinco etapas da #42, na ordem.
 *
 * `aguardando_pagamento` vira "Pedido recebido" e nao "Aguardando pagamento".
 * Nao e contradicao com o selo da lista: o selo diz o ESTADO de agora, a etapa
 * diz o EVENTO que aconteceu. O pedido foi recebido; o que esta pendente e o
 * pagamento, e isso a etapa seguinte mostra estando vazia.
 */
const SEQUENCIA = [
  ['aguardando_pagamento', 'Pedido recebido'],
  ['pago', 'Pagamento confirmado'],
  ['em_producao', 'Em separação'],
  ['enviado', 'Enviado'],
  ['entregue', 'Entregue'],
] as const;

/**
 * Cancelado e reembolsado sao ramo, nao etapa (criterio da #42). Nao cabem na
 * fila porque nao vem depois de nada: sao a fila parando.
 */
const RAMOS = new Map([
  ['cancelado', 'Cancelado'],
  ['reembolsado', 'Reembolsado'],
]);

/** Evento da trilha que o trigger da #18 escreve em `order_status_history`. */
export type EventoDoBanco = { para: string; criado_em: string };

type EstadoDaEtapa = 'feita' | 'atual' | 'futura' | 'nao-aconteceu';

type Etapa = {
  rotulo: string;
  /** ISO do momento em que aconteceu, ou null se nao aconteceu. */
  em: string | null;
  estado: EstadoDaEtapa;
};

export type LinhaDoTempo = {
  etapas: Etapa[];
  ramo: { rotulo: string; em: string | null } | null;
  /**
   * O pedido nao tem trilha nenhuma. Nao deveria acontecer — o trigger escreve
   * desde o insert — mas pedido antigo ou restaurado de backup pode chegar
   * assim, e a tela precisa dizer "nao sei" em vez de desenhar uma fila vazia
   * sem explicacao.
   */
  semRegistro: boolean;
};

export function montaLinhaDoTempo(statusAtual: string, eventos: EventoDoBanco[]): LinhaDoTempo {
  // Map, e nao objeto: chave vinda do banco em objeto literal encontra
  // `constructor` e outros herdados. Ja me pegou uma vez, na #41.
  const primeiraVez = new Map<string, string>();
  const ultimaVez = new Map<string, string>();

  // Ordenado por data. Duas linhas com o mesmo `criado_em` nao mudam nada: a
  // etapa so guarda a data, e as duas tem a mesma.
  for (const evento of [...eventos].sort((a, b) => a.criado_em.localeCompare(b.criado_em))) {
    if (!primeiraVez.has(evento.para)) primeiraVez.set(evento.para, evento.criado_em);
    ultimaVez.set(evento.para, evento.criado_em);
  }

  const rotuloDoRamo = RAMOS.get(statusAtual);

  // So e ramo se for o estado de AGORA. Um cancelamento que foi desfeito nao e
  // mais a historia do pedido; a fila voltou a andar.
  const ramo = rotuloDoRamo
    ? { rotulo: rotuloDoRamo, em: ultimaVez.get(statusAtual) ?? null }
    : null;

  // Primeira vez, e nao ultima, para cada etapa: a pergunta da linha do tempo e
  // "quando isto aconteceu?", e a resposta que mantem a fila em ordem
  // cronologica e a primeira.
  const datas = SEQUENCIA.map(([status]) => primeiraVez.get(status) ?? null);

  let ultimaFeita = -1;
  for (let i = 0; i < datas.length; i++) if (datas[i]) ultimaFeita = i;

  const etapas: Etapa[] = SEQUENCIA.map(([, rotulo], i) => ({
    rotulo,
    em: datas[i],
    estado: estadoDa(i, datas[i], ultimaFeita, ramo !== null),
  }));

  return { etapas, ramo, semRegistro: eventos.length === 0 };
}

function estadoDa(
  indice: number,
  em: string | null,
  ultimaFeita: number,
  emRamo: boolean
): EstadoDaEtapa {
  if (em) {
    // Num pedido cancelado a ultima etapa cumprida nao e "onde o pedido esta":
    // onde ele esta e o ramo. Por isso `atual` so existe fora do ramo.
    return !emRamo && indice === ultimaFeita ? 'atual' : 'feita';
  }
  // Depois do ramo nada mais vai acontecer. Mostrar "Entregue" como pendente
  // num pedido cancelado seria prometer uma entrega que nao vem.
  return emRamo ? 'nao-aconteceu' : 'futura';
}
