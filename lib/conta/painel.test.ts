import { describe, expect, it } from 'vitest';
import { STATUS_PEDIDO } from '@/lib/loja/status-do-pedido';
import {
  contaNoFiltro,
  FILTRO_PADRAO,
  FILTROS_ADMIN,
  leBuscaAdmin,
  linhasDaEntrega,
  montaContagem,
  PAINEL,
  statusDoFiltro,
  urlDoPainel,
} from './painel';
import { leStatus } from './pedidos';

/**
 * O painel le `?status=` e `?p=` da URL (#242). O que se prova aqui e que
 * nada que venha de fora chega na consulta sem passar pela lista fechada.
 */
describe('leBuscaAdmin', () => {
  it('sem parametro nenhum, e a primeira pagina do filtro padrao', () => {
    expect(leBuscaAdmin({})).toEqual({ filtro: 'a-enviar', pagina: 1 });
    expect(FILTRO_PADRAO).toBe('a-enviar');
  });

  it.each(STATUS_PEDIDO)('aceita o status %s', (status) => {
    expect(leBuscaAdmin({ status })).toEqual({ filtro: status, pagina: 1 });
  });

  it('aceita todos e o padrao escrito por extenso', () => {
    expect(leBuscaAdmin({ status: 'todos' }).filtro).toBe('todos');
    expect(leBuscaAdmin({ status: 'a-enviar' }).filtro).toBe('a-enviar');
  });

  // E o caso que justifica o zod: o valor viraria um `in()` com algo que o
  // enum do banco recusa, e a recusa viraria erro na tela.
  it.each([
    ['status inventado', 'extraviado'],
    ['maiusculas', 'PAGO'],
    ['vazio', ''],
    ['tentativa de SQL', "pago' or 1=1 --"],
    ['nome de metodo', 'constructor'],
  ])('%s cai no padrao', (_caso, status) => {
    expect(leBuscaAdmin({ status }).filtro).toBe('a-enviar');
  });

  it('parametro repetido: vale o primeiro, como o Next faz no resto', () => {
    expect(leBuscaAdmin({ status: ['enviado', 'pago'] }).filtro).toBe('enviado');
    expect(leBuscaAdmin({ p: ['3', '9'] }).pagina).toBe(3);
  });

  it('a pagina passa pela mesma regra da lista do cliente', () => {
    expect(leBuscaAdmin({ p: '2' }).pagina).toBe(2);
    expect(leBuscaAdmin({ p: 'abc' }).pagina).toBe(1);
    expect(leBuscaAdmin({ p: '0' }).pagina).toBe(1);
    expect(leBuscaAdmin({ p: '1e9' }).pagina).toBe(500);
  });

  it('os dois juntos, cada um validado por si', () => {
    expect(leBuscaAdmin({ status: 'cancelado', p: '4' })).toEqual({
      filtro: 'cancelado',
      pagina: 4,
    });
    expect(leBuscaAdmin({ status: 'xyz', p: '-1' })).toEqual({ filtro: 'a-enviar', pagina: 1 });
  });

  it('nem objeto: ainda assim uma pagina, e nao uma tela em branco', () => {
    expect(leBuscaAdmin(undefined)).toEqual({ filtro: 'a-enviar', pagina: 1 });
    expect(leBuscaAdmin('pago')).toEqual({ filtro: 'a-enviar', pagina: 1 });
  });
});

describe('statusDoFiltro', () => {
  it('o padrao e o que precisa de etiqueta: pago e em producao', () => {
    expect(statusDoFiltro('a-enviar')).toEqual(['pago', 'em_producao']);
  });

  it('todos nao filtra', () => {
    expect(statusDoFiltro('todos')).toBeNull();
  });

  it.each(STATUS_PEDIDO)('%s filtra so ele', (status) => {
    expect(statusDoFiltro(status)).toEqual([status]);
  });
});

describe('FILTROS_ADMIN', () => {
  it('comeca no padrao, passa por cada status e termina em todos', () => {
    expect(FILTROS_ADMIN.map((f) => f.valor)).toEqual(['a-enviar', ...STATUS_PEDIDO, 'todos']);
  });

  it('o rotulo de cada status e o mesmo do selo', () => {
    for (const status of STATUS_PEDIDO) {
      expect(FILTROS_ADMIN.find((f) => f.valor === status)?.rotulo).toBe(leStatus(status).rotulo);
    }
    expect(FILTROS_ADMIN[0].rotulo).toBe('Para enviar');
  });
});

describe('contagem por status', () => {
  const contagem = montaContagem([
    { status: 'aguardando_pagamento', total: 50 },
    { status: 'pago', total: 7 },
    { status: 'em_producao', total: 3 },
    { status: 'enviado', total: 2 },
  ]);

  it('o filtro composto soma os dois status', () => {
    expect(contaNoFiltro(contagem, 'a-enviar')).toBe(10);
  });

  it('todos e a tabela inteira', () => {
    expect(contaNoFiltro(contagem, 'todos')).toBe(62);
  });

  it('status sem linha conta zero, e nao undefined na tela', () => {
    expect(contaNoFiltro(contagem, 'cancelado')).toBe(0);
    expect(contaNoFiltro(contagem, 'enviado')).toBe(2);
  });

  // Mesma tolerancia de leStatus: status novo no banco, tipos nao regenerados.
  it('status que o TypeScript nao conhece entra so no total', () => {
    const comNovo = montaContagem([
      { status: 'pago', total: 1 },
      { status: 'extraviado', total: 4 },
    ]);

    expect(contaNoFiltro(comNovo, 'todos')).toBe(5);
    expect(contaNoFiltro(comNovo, 'a-enviar')).toBe(1);
    expect(Object.keys(comNovo.porStatus)).toEqual(['pago']);
  });

  it('sem linha nenhuma, tudo zero', () => {
    const vazia = montaContagem([]);
    expect(contaNoFiltro(vazia, 'todos')).toBe(0);
    expect(contaNoFiltro(vazia, 'a-enviar')).toBe(0);
  });
});

describe('urlDoPainel', () => {
  it('o padrao na pagina 1 e o endereco limpo', () => {
    expect(urlDoPainel('a-enviar')).toBe(PAINEL);
    expect(urlDoPainel('a-enviar', 1)).toBe('/conta/admin/pedidos');
  });

  it('filtro e pagina so vao para a URL quando saem do padrao', () => {
    expect(urlDoPainel('pago')).toBe('/conta/admin/pedidos?status=pago');
    expect(urlDoPainel('a-enviar', 2)).toBe('/conta/admin/pedidos?p=2');
    expect(urlDoPainel('todos', 3)).toBe('/conta/admin/pedidos?status=todos&p=3');
  });

  it('o que sai volta igual pela leitura', () => {
    for (const f of FILTROS_ADMIN) {
      const url = new URL(urlDoPainel(f.valor, 2), 'http://x');
      expect(leBuscaAdmin(Object.fromEntries(url.searchParams))).toEqual({
        filtro: f.valor,
        pagina: 2,
      });
    }
  });
});

describe('linhasDaEntrega', () => {
  const entrega = {
    nome: 'Ana Souza',
    logradouro: 'Avenida Paulista',
    numero: '1578',
    complemento: 'apto 92',
    bairro: 'Bela Vista',
    cidade: 'São Paulo',
    uf: 'SP',
    cep: '01310-100',
    linha: 'Avenida Paulista, 1578, apto 92 — Bela Vista, São Paulo/SP — 01310-100',
  };

  it('quatro linhas, na ordem da etiqueta: quem, rua, bairro e cidade, CEP', () => {
    expect(linhasDaEntrega(entrega)).toEqual([
      'Ana Souza',
      'Avenida Paulista, 1578, apto 92',
      'Bela Vista — São Paulo/SP',
      'CEP 01310-100',
    ]);
  });

  it('sem complemento nao sobra virgula', () => {
    expect(linhasDaEntrega({ ...entrega, complemento: null })[1]).toBe('Avenida Paulista, 1578');
  });
});
