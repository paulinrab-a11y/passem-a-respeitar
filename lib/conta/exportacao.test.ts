import { describe, expect, it } from 'vitest';
import {
  CABECALHO,
  celula,
  csvDePedidos,
  type LinhaParaExportar,
  nomeDoArquivo,
} from './exportacao';

/**
 * A planilha do dono (#345). O que se prova aqui e o que daria errado em
 * silencio: formula digitada pelo comprador virando formula no Excel do dono,
 * aspa quebrando a linha, e o pedido anonimizado vazando o que nao tem.
 */

const PEDIDO: LinhaParaExportar = {
  numero: 42,
  criado_em: '2026-10-15T17:03:00.000Z',
  status: 'pago',
  total_centavos: 14990,
  frete_centavos: 2990,
  frete_servico: 'sedex',
  frete_prazo_dias: 3,
  entrega_nome: 'Fulana de Tal',
  entrega_cep: '01310100',
  entrega_logradouro: 'Avenida Paulista',
  entrega_numero: '1000',
  entrega_complemento: 'ap 12',
  entrega_bairro: 'Bela Vista',
  entrega_cidade: 'São Paulo',
  entrega_uf: 'SP',
  order_items: [{ nome: 'Camiseta CBAC', tamanho: 'M', quantidade: 1 }],
};

/** As celulas de uma linha do CSV, sem as aspas de fora. */
const celulas = (linha: string) =>
  linha
    .slice(1, -1)
    .split('";"')
    .map((c) => c.replace(/""/g, '"'));

/** As linhas de dados, sem o BOM e sem o cabecalho. */
const dados = (pedidos: LinhaParaExportar[]) =>
  csvDePedidos(pedidos).slice(1).split('\r\n').slice(1);

describe('celula', () => {
  it.each([
    ['=HYPERLINK("http://x","clique")'],
    ['+5511999999999'],
    ['-2+3'],
    ['@SUM(A1:A2)'],
    ['\t=1+1'],
    ['\r=1+1'],
  ])('neutraliza o que a planilha leria como formula: %j', (perigoso) => {
    expect(celula(perigoso).startsWith(`"'`)).toBe(true);
  });

  it('nao mexe em texto comum', () => {
    expect(celula('Rua A, 10')).toBe('"Rua A, 10"');
    expect(celula(42)).toBe('"42"');
    expect(celula(null)).toBe('""');
  });

  it('dobra a aspa dentro do texto (RFC 4180)', () => {
    expect(celula('Casa "azul"')).toBe('"Casa ""azul"""');
  });

  it('formula com aspa dentro sai neutralizada e escapada', () => {
    expect(celula('=1+"a"')).toBe('"\'=1+""a"""');
  });
});

describe('csvDePedidos', () => {
  it('comeca com BOM e o cabecalho, e separa linhas com CRLF', () => {
    const csv = csvDePedidos([PEDIDO]);
    expect(csv.startsWith('﻿')).toBe(true);

    const [cabecalho, ...resto] = csv.slice(1).split('\r\n');
    expect(celulas(cabecalho)).toEqual([...CABECALHO]);
    expect(resto).toHaveLength(1);
  });

  it('uma linha por pedido, com as colunas pedidas', () => {
    const [numero, data, nome, endereco, tamanho, quantidade, frete, total, status] = celulas(
      dados([PEDIDO])[0]
    );

    expect(numero).toBe('42');
    // 17:03 UTC sao 14:03 em Sao Paulo.
    expect(data).toBe('2026-10-15 14:03');
    expect(nome).toBe('Fulana de Tal');
    expect(endereco).toBe(
      'Avenida Paulista, 1000, ap 12 — Bela Vista, São Paulo/SP — CEP 01310-100'
    );
    expect(tamanho).toBe('M');
    expect(quantidade).toBe('1');
    expect(frete).toMatch(/^SEDEX R\$\s29,90$/);
    expect(total).toMatch(/^R\$\s149,90$/);
    expect(status).toBe('Pago');
  });

  it('o que o comprador digitou nao vira formula', () => {
    const [linha] = dados([{ ...PEDIDO, entrega_nome: '=cmd|"/c calc"!A1' }]);

    expect(celulas(linha)[2]).toBe('\'=cmd|"/c calc"!A1');
  });

  it('mais de um tamanho leva a quantidade de cada, e a coluna soma', () => {
    const [linha] = dados([
      {
        ...PEDIDO,
        order_items: [
          { nome: 'Camiseta CBAC', tamanho: 'M', quantidade: 2 },
          { nome: 'Camiseta CBAC', tamanho: 'G', quantidade: 1 },
        ],
      },
    ]);

    expect(celulas(linha)[4]).toBe('M (2), G (1)');
    expect(celulas(linha)[5]).toBe('3');
  });

  it('pedido anonimizado sai sem nome e sem endereco, mas sai', () => {
    const [linha] = dados([
      {
        ...PEDIDO,
        entrega_nome: null,
        entrega_cep: null,
        entrega_logradouro: null,
        entrega_numero: null,
        entrega_complemento: null,
        entrega_bairro: null,
        entrega_cidade: null,
        entrega_uf: null,
      },
    ]);

    const c = celulas(linha);
    expect(c[0]).toBe('42');
    expect(c[2]).toBe('');
    expect(c[3]).toBe('');
  });

  it('sem pedido, so o cabecalho', () => {
    expect(dados([])).toEqual([]);
  });
});

describe('nomeDoArquivo', () => {
  it('leva o dia no fuso da loja', () => {
    // 01:00 UTC do dia 16 ainda e dia 15 em Sao Paulo.
    expect(nomeDoArquivo(new Date('2026-10-16T01:00:00.000Z'))).toBe('pedidos-2026-10-15.csv');
  });
});
