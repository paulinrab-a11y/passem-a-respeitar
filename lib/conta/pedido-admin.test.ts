import { describe, expect, it } from 'vitest';
import { type LinhaDoPainel, mapeiaPedidoDoPainel, nomeDoAutor, quemLer } from './pedido-admin';

/**
 * O pedido visto pelo dono (#345). O mapper decide o que sai do banco para a
 * tela: autor e motivo saem (o cliente nao os ve); a chave de idempotencia e o
 * id do provedor nem chegam aqui — a consulta nao os nomeia.
 */

const COMPRADOR = 'aaaaaaaa-0000-4000-8000-000000000001';
const DONO = 'aaaaaaaa-0000-4000-8000-000000000002';

const LINHA: LinhaDoPainel = {
  numero: 7,
  status: 'em_producao',
  criado_em: '2026-10-14T12:00:00.000Z',
  total_centavos: 14990,
  frete_centavos: 2990,
  frete_servico: 'sedex',
  frete_prazo_dias: 3,
  user_id: COMPRADOR,
  termos_aceitos_em: '2026-10-14T12:00:00.000Z',
  termos_versao: '2026-10-15T20:00:00-03:00',
  rastreio_codigo: null,
  rastreio_url: null,
  entrega_nome: 'Fulana',
  entrega_cep: '01310100',
  entrega_logradouro: 'Avenida Paulista',
  entrega_numero: '1000',
  entrega_complemento: null,
  entrega_bairro: 'Bela Vista',
  entrega_cidade: 'São Paulo',
  entrega_uf: 'SP',
  order_items: [
    {
      id: 'i1',
      nome: 'Camiseta CBAC',
      tamanho: 'M',
      quantidade: 1,
      preco_unitario_centavos: 12000,
    },
  ],
  order_status_history: [
    {
      id: 'h3',
      para: 'em_producao',
      autor: DONO,
      motivo: '  separado  ',
      criado_em: '2026-10-14T15:00:00.000Z',
    },
    {
      id: 'h1',
      para: 'aguardando_pagamento',
      autor: COMPRADOR,
      motivo: null,
      criado_em: '2026-10-14T12:00:00.000Z',
    },
    { id: 'h2', para: 'pago', autor: null, motivo: '', criado_em: '2026-10-14T12:05:00.000Z' },
  ],
  pagamentos: [
    {
      tentativa: 1,
      metodo: 'credit_card',
      estado: 'recusado',
      provedor_status_detail: 'cc_rejected_insufficient_amount',
      valor_centavos: 14990,
      criado_em: '2026-10-14T12:01:00.000Z',
    },
    {
      tentativa: 2,
      metodo: 'pix',
      estado: 'aprovado',
      provedor_status_detail: 'accredited',
      valor_centavos: 14990,
      criado_em: '2026-10-14T12:04:00.000Z',
    },
  ],
};

const EMAILS = new Map([
  [COMPRADOR, 'comprador@exemplo.test'],
  [DONO, 'dono@exemplo.test'],
]);

describe('mapeiaPedidoDoPainel', () => {
  const p = mapeiaPedidoDoPainel(LINHA, EMAILS);

  it('o resumo dos itens e o mesmo do card', () => {
    expect(p.resumo).toBe('1× Camiseta CBAC · M');
  });

  it('a trilha vem em ordem, com quem mudou e o motivo', () => {
    expect(p.trilha.map((e) => e.rotulo)).toEqual(['Aguardando pagamento', 'Pago', 'Em produção']);
    expect(p.trilha.map((e) => nomeDoAutor(e.autor))).toEqual([
      'comprador',
      'sistema',
      'dono@exemplo.test',
    ]);
    // Motivo vazio e o mesmo que nenhum; com espaco em volta, aparado.
    expect(p.trilha.map((e) => e.motivo)).toEqual([null, null, 'separado']);
  });

  it('as tentativas vem da mais nova, com o detalhe cru do provedor', () => {
    expect(p.tentativas.map((t) => t.tentativa)).toEqual([2, 1]);
    expect(p.tentativas[1]).toMatchObject({
      metodo: 'Cartão de crédito',
      estado: 'Recusado',
      detalhe: 'cc_rejected_insufficient_amount',
    });
  });

  it('o e-mail do comprador vem do mapa', () => {
    expect(p.email).toBe('comprador@exemplo.test');
  });

  it('o rastreio sai quando ha codigo (#378)', () => {
    expect(mapeiaPedidoDoPainel(LINHA, EMAILS).rastreio).toBeNull();
    expect(
      mapeiaPedidoDoPainel(
        { ...LINHA, status: 'enviado', rastreio_codigo: 'AB123456789BR' },
        EMAILS
      ).rastreio
    ).toEqual({ codigo: 'AB123456789BR', url: null });
  });

  it('a versao dos termos aceita vai para a tela (#380)', () => {
    expect(mapeiaPedidoDoPainel(LINHA, EMAILS).termosVersao).toBe('2026-10-15T20:00:00-03:00');
    expect(mapeiaPedidoDoPainel({ ...LINHA, termos_versao: null }, EMAILS).termosVersao).toBeNull();
  });

  it('nada de user_id na saida', () => {
    expect(JSON.stringify(p)).not.toContain(COMPRADOR);
    expect(JSON.stringify(p)).not.toContain(DONO);
  });

  it('autor que nao se leu vira "conta excluida", e pedido anonimizado fica sem e-mail', () => {
    const anonimo = mapeiaPedidoDoPainel({ ...LINHA, user_id: null }, new Map());

    expect(anonimo.email).toBeNull();
    expect(nomeDoAutor(anonimo.trilha[2].autor)).toBe('conta excluída');
  });

  it('estado fora do vocabulario sai cru, e metodo nulo sai como traco', () => {
    const [t] = mapeiaPedidoDoPainel(
      {
        ...LINHA,
        pagamentos: [{ ...LINHA.pagamentos[0], estado: 'novo_estado', metodo: null }],
      },
      EMAILS
    ).tentativas;

    expect(t.estado).toBe('novo_estado');
    expect(t.metodo).toBe('—');
  });
});

describe('quemLer', () => {
  it('comprador e autores, sem repetir e sem nulo', () => {
    expect(quemLer(LINHA)).toEqual([COMPRADOR, DONO]);
  });

  it('pedido anonimizado le so os autores', () => {
    expect(quemLer({ ...LINHA, user_id: null })).toEqual([DONO, COMPRADOR]);
  });
});
