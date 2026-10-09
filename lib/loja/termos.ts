/**
 * Termos de compra, trocas e arrependimento (Issue #276).
 *
 * Os numeros da pagina /termos moram aqui, e nao no texto, pelo mesmo motivo
 * do prazo de producao (#197): o bloco do detalhe do pedido repete os mesmos
 * prazos, e escritos a mao em dois lugares bastava mudar um para o site
 * prometer duas coisas na mesma visita.
 *
 * As politicas sao as do padrao brasileiro, por decisao do dono em 09/10/2026
 * ("pode colocar as politicas normais do Brasil"): Codigo de Defesa do
 * Consumidor e Decreto 7.962/2013. Sem `server-only`: so numeros e uma funcao
 * pura, que a pagina de servidor e o teste leem.
 */

import { type Dia, diaMaisDias } from '@/lib/datas';

export const TERMOS = '/termos';

/**
 * Quando o texto mudou pela ultima vez. Muda junto com o texto: e a versao
 * que vale para o pedido aceito depois desta data.
 */
export const TERMOS_ATUALIZADOS_EM = '2026-10-09T12:00:00-03:00';

/** CDC, art. 49: compra fora da loja fisica, desistencia sem motivo. */
export const ARREPENDIMENTO_DIAS = 7;

/** CDC, art. 26, II: vicio de produto duravel. */
export const GARANTIA_DIAS = 90;

/** CDC, art. 18, § 1º: prazo para sanar o vicio. */
export const CONSERTO_DIAS = 30;

/** Cortesia da loja, alem da lei: troca de tamanho. */
export const TROCA_DE_TAMANHO_DIAS = 7;

/** Quanto a loja leva para responder a um pedido de cancelamento, troca ou defeito. */
export const RESPOSTA_DIAS_UTEIS = 2;

/**
 * O que a pessoa pode fazer com o pedido agora, e ate quando (#276).
 *
 * So o que os dados do pedido sustentam. O unico dia que o banco tem perto do
 * recebimento e o da etapa "entregue" da trilha — quando o dono marca no
 * painel. Pedido enviado sem esse registro nao ganha contagem regressiva: a
 * tela explica a regra dos sete dias a partir do recebimento, e nao inventa
 * uma data que ninguem mediu.
 */
export type PosVenda =
  /** Nada foi cobrado: desistir e nao pagar. */
  | { etapa: 'sem-pagamento' }
  /** Pago e ainda na loja: cancela com tudo de volta. */
  | { etapa: 'antes-do-envio' }
  /** Saiu e nao ha data de entrega registrada. */
  | { etapa: 'a-caminho' }
  | {
      etapa: 'entregue';
      /** Nulo quando o pedido esta entregue sem o dia registrado na trilha. */
      prazos: {
        entregueEm: Dia;
        arrependimentoAte: Dia;
        trocaAte: Dia;
        garantiaAte: Dia;
        /** Hoje ainda cabe desistir. */
        arrependimentoAberto: boolean;
        trocaAberta: boolean;
        garantiaAberta: boolean;
      } | null;
    };

/**
 * `status` e o de agora; `entregueEm`, o primeiro registro da etapa
 * "entregue" na trilha. `agora` e injetavel para o teste nao depender do
 * relogio.
 *
 * Cancelado e reembolsado nao tem bloco: o pedido acabou, e nao ha o que
 * pedir. Status desconhecido tambem nao — melhor nenhuma promessa que a
 * errada.
 */
export function posVendaDoPedido(
  status: string,
  entregueEm: string | null,
  agora: Date = new Date()
): PosVenda | null {
  if (status === 'aguardando_pagamento') return { etapa: 'sem-pagamento' };
  if (status === 'pago' || status === 'em_producao') return { etapa: 'antes-do-envio' };
  if (status === 'enviado') return { etapa: 'a-caminho' };
  if (status !== 'entregue') return null;

  if (!entregueEm) return { etapa: 'entregue', prazos: null };

  const hoje = diaMaisDias(agora.toISOString(), 0).iso;
  const arrependimentoAte = diaMaisDias(entregueEm, ARREPENDIMENTO_DIAS);
  const trocaAte = diaMaisDias(entregueEm, TROCA_DE_TAMANHO_DIAS);
  const garantiaAte = diaMaisDias(entregueEm, GARANTIA_DIAS);

  return {
    etapa: 'entregue',
    prazos: {
      entregueEm: diaMaisDias(entregueEm, 0),
      arrependimentoAte,
      trocaAte,
      garantiaAte,
      // O ultimo dia conta inteiro: no dia 12, ainda cabe.
      arrependimentoAberto: hoje <= arrependimentoAte.iso,
      trocaAberta: hoje <= trocaAte.iso,
      garantiaAberta: hoje <= garantiaAte.iso,
    },
  };
}
