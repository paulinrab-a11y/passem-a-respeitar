/**
 * Um pedido visto pelo dono (Issue #345).
 *
 * Funcao pura, como pedidos.ts: a consulta mora na pagina, que confere o
 * papel antes; aqui fica o mapper, que e onde se decide o que o dono ve e o
 * que continua no banco.
 *
 * O dono ve mais que o cliente — autor e motivo da trilha, as tentativas de
 * pagamento com o detalhe do provedor, o e-mail de quem comprou —, porque e
 * com isso que ele responde "meu cartao foi recusado, por que?". O que nem
 * ele ve: `idempotency_key` e o id da ordem no Mercado Pago, que servem a
 * conciliacao e a nada na tela; e o `user_id`, que so serve para achar o
 * e-mail.
 */

import { leRastreio, type RastreioDoPedido } from '@/lib/loja/rastreio';
import { type ItemDoPainel, resumoDosItens } from './painel';
import {
  type EntregaDoPedido,
  type FreteDoPedido,
  type LinhaComEntrega,
  leEntrega,
  leFrete,
  leStatus,
  reais,
  type Tom,
} from './pedidos';

/** Quem mudou o status, como o banco grava: o uuid da sessao, ou nulo. */
export type AutorDaTrilha =
  /** Nulo: gatilho do banco, webhook, cron. Ninguem logado mudou. */
  | { tipo: 'sistema' }
  | { tipo: 'comprador' }
  /** Outra pessoa: o administrador. O e-mail, quando ainda existe a conta. */
  | { tipo: 'pessoa'; email: string | null };

type EventoDoPainel = {
  id: string;
  rotulo: string;
  em: string;
  autor: AutorDaTrilha;
  motivo: string | null;
};

type TentativaDoPainel = {
  tentativa: number;
  metodo: string;
  estado: string;
  /** O codigo cru do provedor (`cc_rejected_insufficient_amount`). */
  detalhe: string | null;
  valor: string;
  em: string;
};

export type PedidoDoPainel = {
  numero: number;
  status: string;
  criadoEm: string;
  rotulo: string;
  tom: Tom;
  total: string;
  frete: FreteDoPedido | null;
  entrega: EntregaDoPedido | null;
  /** "1× Camiseta CBAC · M", como no card. */
  resumo: string;
  itens: (ItemDoPainel & { id: string; precoUnitario: string })[];
  /** Mais antigo primeiro: e uma historia. */
  trilha: EventoDoPainel[];
  /** Mais nova primeiro: a ultima e a que o cliente esta reclamando. */
  tentativas: TentativaDoPainel[];
  /** Nulo: conta excluida (pedido anonimizado) ou e-mail que nao se leu. */
  email: string | null;
  /** Quando aceitou os termos (#276). Nulo nos pedidos de antes. */
  termosAceitosEm: string | null;
  /** O codigo dos Correios gravado ao marcar enviado (#378). */
  rastreio: RastreioDoPedido | null;
};

export type LinhaDoPainel = LinhaComEntrega & {
  numero: number;
  status: string;
  criado_em: string;
  total_centavos: number;
  frete_centavos: number;
  frete_servico: string | null;
  frete_prazo_dias: number | null;
  user_id: string | null;
  termos_aceitos_em: string | null;
  rastreio_codigo: string | null;
  rastreio_url: string | null;
  order_items: {
    id: string;
    nome: string;
    tamanho: string | null;
    quantidade: number;
    preco_unitario_centavos: number;
  }[];
  order_status_history: {
    id: string;
    para: string;
    autor: string | null;
    motivo: string | null;
    criado_em: string;
  }[];
  pagamentos: {
    tentativa: number;
    metodo: string | null;
    estado: string;
    provedor_status_detail: string | null;
    valor_centavos: number;
    criado_em: string;
  }[];
};

const METODOS: Record<string, string> = {
  pix: 'Pix',
  credit_card: 'Cartão de crédito',
  debit_card: 'Cartão de débito',
};

/**
 * O vocabulario NOSSO de `estado_pagamento`, em palavras. `criado` e a
 * tentativa que saiu daqui e nao teve resposta — a conciliacao ainda vai
 * perguntar ao provedor o que houve com ela.
 */
const ESTADOS: Record<string, string> = {
  criado: 'Sem resposta do provedor',
  pendente: 'Pendente',
  aprovado: 'Aprovado',
  recusado: 'Recusado',
  cancelado: 'Cancelado',
  estornado: 'Estornado',
};

/** Valor fora do mapa sai cru: e o dono lendo, e o cru e melhor que nada. */
function traduz(mapa: Record<string, string>, valor: string | null): string {
  if (!valor) return '—';
  return Object.hasOwn(mapa, valor) ? mapa[valor] : valor;
}

/**
 * `emails` traz o e-mail de cada uuid que a pagina conseguiu ler — do
 * comprador e de quem aparece como autor na trilha. Quem nao esta no mapa e
 * conta excluida, ou leitura que falhou: a tela diz "sem e-mail", nao inventa.
 */
export function mapeiaPedidoDoPainel(
  linha: LinhaDoPainel,
  emails: ReadonlyMap<string, string>
): PedidoDoPainel {
  const { rotulo, tom } = leStatus(linha.status);

  const autor = (id: string | null): AutorDaTrilha => {
    if (!id) return { tipo: 'sistema' };
    if (id === linha.user_id) return { tipo: 'comprador' };
    return { tipo: 'pessoa', email: emails.get(id) ?? null };
  };

  return {
    numero: linha.numero,
    status: linha.status,
    criadoEm: linha.criado_em,
    rotulo,
    tom,
    total: reais(linha.total_centavos),
    frete: leFrete(linha.frete_servico, linha.frete_centavos, linha.frete_prazo_dias),
    entrega: leEntrega(linha),
    resumo: resumoDosItens(linha.order_items),
    itens: linha.order_items.map((i) => ({
      id: i.id,
      nome: i.nome,
      tamanho: i.tamanho,
      quantidade: i.quantidade,
      precoUnitario: reais(i.preco_unitario_centavos),
    })),
    trilha: [...linha.order_status_history]
      .sort((a, b) => a.criado_em.localeCompare(b.criado_em))
      .map((e) => ({
        id: e.id,
        rotulo: leStatus(e.para).rotulo,
        em: e.criado_em,
        autor: autor(e.autor),
        motivo: e.motivo?.trim() || null,
      })),
    tentativas: [...linha.pagamentos]
      .sort((a, b) => b.tentativa - a.tentativa)
      .map((p) => ({
        tentativa: p.tentativa,
        metodo: traduz(METODOS, p.metodo),
        estado: traduz(ESTADOS, p.estado),
        detalhe: p.provedor_status_detail,
        valor: reais(p.valor_centavos),
        em: p.criado_em,
      })),
    email: linha.user_id ? (emails.get(linha.user_id) ?? null) : null,
    termosAceitosEm: linha.termos_aceitos_em,
    rastreio: leRastreio(linha.rastreio_codigo, linha.rastreio_url),
  };
}

/** Os uuids cujo e-mail a pagina precisa ler: comprador e autores. Sem repetir. */
export function quemLer(linha: Pick<LinhaDoPainel, 'user_id' | 'order_status_history'>): string[] {
  const ids = new Set<string>();
  if (linha.user_id) ids.add(linha.user_id);
  for (const e of linha.order_status_history) if (e.autor) ids.add(e.autor);
  return [...ids];
}

/** Como a trilha nomeia quem mudou. */
export function nomeDoAutor(autor: AutorDaTrilha): string {
  if (autor.tipo === 'sistema') return 'sistema';
  if (autor.tipo === 'comprador') return 'comprador';
  return autor.email ?? 'conta excluída';
}
