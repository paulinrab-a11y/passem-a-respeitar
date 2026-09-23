import { describe, expect, it } from 'vitest';
import { leStatus, mapeiaPedidos, paginaValida, reais } from './pedidos';

/** O Intl usa espaco nao-separavel entre `R$` e o numero. */
const limpo = (texto: string) => texto.replace(/ /g, ' ');

describe('leStatus', () => {
  it.each([
    ['aguardando_pagamento', 'Aguardando pagamento', 'atencao'],
    ['pago', 'Pago', 'normal'],
    ['em_producao', 'Em produção', 'normal'],
    ['enviado', 'Enviado', 'normal'],
    ['entregue', 'Entregue', 'normal'],
    ['cancelado', 'Cancelado', 'apagado'],
    ['reembolsado', 'Reembolsado', 'apagado'],
  ])('traduz %s', (status, rotulo, tom) => {
    expect(leStatus(status)).toEqual({ rotulo, tom });
  });

  // O caso que justifica a funcao existir em vez de um acesso direto ao
  // Record: status novo no banco com os tipos ainda nao regenerados.
  it('nao quebra com status que o TypeScript nao conhece', () => {
    expect(leStatus('extraviado')).toEqual({ rotulo: 'Em andamento', tom: 'normal' });
  });

  it('nao se confunde com nome de metodo de Object', () => {
    expect(leStatus('constructor')).toEqual({ rotulo: 'Em andamento', tom: 'normal' });
  });
});

describe('reais', () => {
  it.each([
    [0, 'R$ 0,00'],
    [1, 'R$ 0,01'],
    [99, 'R$ 0,99'],
    [12000, 'R$ 120,00'],
    [999999, 'R$ 9.999,99'],
  ])('%i centavos vira %s', (centavos, esperado) => {
    expect(limpo(reais(centavos))).toBe(esperado);
  });

  // 3335 / 100 em binario nao e exatamente 33.35. Se um dia a formatacao
  // passar por arredondamento proprio, e aqui que aparece.
  it('nao perde centavo em valor que nao fecha em binario', () => {
    expect(limpo(reais(3335))).toBe('R$ 33,35');
  });
});

describe('mapeiaPedidos', () => {
  const linha = {
    numero: 12,
    criado_em: '2026-09-20T18:30:00Z',
    status: 'aguardando_pagamento',
    total_centavos: 24000,
    order_items: [
      {
        id: 'item-1',
        nome: 'Camiseta CBAC x Passem a Respeitar',
        tamanho: 'M',
        quantidade: 2,
        preco_unitario_centavos: 12000,
      },
    ],
  };

  it('devolve o pedido pronto para a tela', () => {
    const [pedido] = mapeiaPedidos([linha]);

    expect(pedido.numero).toBe(12);
    expect(pedido.criadoEm).toBe('2026-09-20T18:30:00Z');
    expect(pedido.rotulo).toBe('Aguardando pagamento');
    expect(pedido.tom).toBe('atencao');
    expect(limpo(pedido.total)).toBe('R$ 240,00');
    expect(limpo(pedido.itens[0].precoUnitario)).toBe('R$ 120,00');
    expect(pedido.itens[0]).toMatchObject({ nome: linha.order_items[0].nome, tamanho: 'M' });
  });

  // Este e o teste da Issue #20, e o unico que pega um `select *` voltando a
  // se infiltrar: a lista de chaves e fechada, entao campo novo no banco nao
  // chega na tela sem alguem escrever o nome dele no mapper.
  it('nao carrega nenhum campo alem dos declarados', () => {
    const comSujeira = {
      ...linha,
      user_id: '00000000-0000-0000-0000-000000000000',
      pagamento_id: 'mp-999',
      pagamento_provedor: 'mercadopago',
      anonimizado_em: null,
    } as unknown as typeof linha;

    const [pedido] = mapeiaPedidos([comSujeira]);

    expect(Object.keys(pedido).sort()).toEqual([
      'criadoEm',
      'itens',
      'numero',
      'rotulo',
      'tom',
      'total',
    ]);
    expect(Object.keys(pedido.itens[0]).sort()).toEqual([
      'id',
      'nome',
      'precoUnitario',
      'quantidade',
      'tamanho',
    ]);
  });

  it('aceita pedido sem item e tamanho nulo', () => {
    const [semItem] = mapeiaPedidos([{ ...linha, order_items: [] }]);
    expect(semItem.itens).toEqual([]);

    const [semTamanho] = mapeiaPedidos([
      { ...linha, order_items: [{ ...linha.order_items[0], tamanho: null }] },
    ]);
    expect(semTamanho.itens[0].tamanho).toBeNull();
  });

  it('preserva a ordem que o banco entregou', () => {
    const pedidos = mapeiaPedidos([linha, { ...linha, numero: 7 }]);
    expect(pedidos.map((p) => p.numero)).toEqual([12, 7]);
  });
});

describe('paginaValida', () => {
  it.each([
    ['undefined', undefined, 1],
    ['vazio', '', 1],
    ['texto', 'abc', 1],
    ['zero', '0', 1],
    ['negativo', '-3', 1],
    ['fracionario', '2.5', 1],
    ['espacos em volta', ' 3 ', 3],
    ['numero normal', '2', 2],
  ])('%s vira %i', (_caso, bruto, esperado) => {
    expect(paginaValida(bruto)).toBe(esperado);
  });

  // `?p=1&p=2` chega como array. Vale a primeira, como o Next faz no resto.
  it('pega o primeiro quando o parametro vem repetido', () => {
    expect(paginaValida(['4', '9'])).toBe(4);
  });

  it('limita a pagina para o range nao explodir no PostgREST', () => {
    expect(paginaValida('1e9')).toBe(500);
    expect(paginaValida('99999999999999999999999')).toBe(500);
  });

  it('nao deixa Infinity virar offset', () => {
    expect(paginaValida('1e400')).toBe(1);
  });
});
