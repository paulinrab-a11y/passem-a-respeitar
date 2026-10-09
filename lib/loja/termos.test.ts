import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ARREPENDIMENTO_DIAS,
  GARANTIA_DIAS,
  posVendaDoPedido,
  TROCA_DE_TAMANHO_DIAS,
} from './termos';

/**
 * O que a pessoa pode fazer com o pedido, e ate quando (#276).
 *
 * Em UTC, como a Vercel e a CI: e onde uma conta de prazo feita no relogio, e
 * nao no calendario de Brasilia, erraria o dia. Mesmo cuidado de datas.test.ts.
 */
const TZ_ORIGINAL = process.env.TZ;
beforeAll(() => {
  process.env.TZ = 'UTC';
});
afterAll(() => {
  if (TZ_ORIGINAL === undefined) delete process.env.TZ;
  else process.env.TZ = TZ_ORIGINAL;
});

/** Entregue as 22:00 de 05/10 em Brasilia, que em UTC ja e 06/10. */
const ENTREGUE_A_NOITE = '2026-10-06T01:00:00Z';

describe('posVendaDoPedido', () => {
  it('as regras da pagina sao as da lei e as da loja', () => {
    // CDC, art. 49 e art. 26, II. A troca de tamanho e cortesia da loja.
    expect(ARREPENDIMENTO_DIAS).toBe(7);
    expect(GARANTIA_DIAS).toBe(90);
    expect(TROCA_DE_TAMANHO_DIAS).toBe(7);
  });

  it('aguardando pagamento: nada cobrado, desistir e nao pagar', () => {
    expect(posVendaDoPedido('aguardando_pagamento', null)).toEqual({ etapa: 'sem-pagamento' });
  });

  it.each(['pago', 'em_producao'])('%s: ainda cabe cancelar antes do envio', (status) => {
    expect(posVendaDoPedido(status, null)).toEqual({ etapa: 'antes-do-envio' });
  });

  // Saiu da loja e o banco nao tem quando chegou: nenhuma data inventada.
  it('enviado: a regra, sem contagem regressiva', () => {
    expect(posVendaDoPedido('enviado', null)).toEqual({ etapa: 'a-caminho' });
  });

  it('entregue sem o dia na trilha: a regra, sem prazo calculado', () => {
    expect(posVendaDoPedido('entregue', null)).toEqual({ etapa: 'entregue', prazos: null });
  });

  // O pedido acabou: nao ha o que pedir. Status desconhecido nao ganha
  // promessa nenhuma.
  it.each(['cancelado', 'reembolsado', 'status-novo', ''])('%j: sem bloco', (status) => {
    expect(posVendaDoPedido(status, null)).toBeNull();
  });

  it('entregue: os prazos contam do dia de Brasilia, nao do dia em UTC', () => {
    const r = posVendaDoPedido('entregue', ENTREGUE_A_NOITE, new Date('2026-10-07T15:00:00Z'));

    expect(r).toEqual({
      etapa: 'entregue',
      prazos: {
        entregueEm: { iso: '2026-10-05', texto: '05/10/2026' },
        // O dia da entrega nao conta; o setimo conta inteiro.
        arrependimentoAte: { iso: '2026-10-12', texto: '12/10/2026' },
        trocaAte: { iso: '2026-10-12', texto: '12/10/2026' },
        garantiaAte: { iso: '2027-01-03', texto: '03/01/2027' },
        arrependimentoAberto: true,
        trocaAberta: true,
        garantiaAberta: true,
      },
    });
  });

  it('no ultimo dia, ate a meia-noite de Brasilia, ainda cabe desistir', () => {
    // 23:59 de 12/10 em Brasilia; em UTC, ja e dia 13.
    const ultimoMinuto = new Date('2026-10-13T02:59:00Z');
    const r = posVendaDoPedido('entregue', ENTREGUE_A_NOITE, ultimoMinuto);

    expect(r?.etapa === 'entregue' && r.prazos?.arrependimentoAberto).toBe(true);
  });

  it('no dia seguinte ao ultimo, o arrependimento fecha e a garantia segue', () => {
    const dia13 = new Date('2026-10-13T03:00:00Z');
    const r = posVendaDoPedido('entregue', ENTREGUE_A_NOITE, dia13);

    expect(r?.etapa === 'entregue' && r.prazos).toMatchObject({
      arrependimentoAberto: false,
      trocaAberta: false,
      garantiaAberta: true,
    });
  });

  it('passados os noventa dias, a garantia legal tambem fecha', () => {
    const r = posVendaDoPedido('entregue', ENTREGUE_A_NOITE, new Date('2027-01-04T12:00:00Z'));

    expect(r?.etapa === 'entregue' && r.prazos?.garantiaAberta).toBe(false);
  });
});
