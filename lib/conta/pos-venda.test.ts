import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ARREPENDIMENTO_DIAS, posVendaDoPedido, TROCA_DE_TAMANHO_DIAS } from '@/lib/loja/termos';
import {
  BOTAO_DO_TIPO,
  ehTipoPosVenda,
  MENSAGEM_MAX,
  mapeiaSolicitacoes,
  TIPOS_POS_VENDA,
  tiposAbertos,
  tiposQueCabem,
} from './pos-venda';

/**
 * O que a tela oferece pedir (#379). A regra que vale e a do banco
 * (`pos_venda_cabe`); estes testes garantem que a tela nao oferece o que o
 * banco recusaria, e que os numeros dos dois sao os mesmos.
 */

const MIGRATION = readFileSync(
  join(process.cwd(), 'supabase/migrations/20261015190000_solicitacoes_pos_venda.sql'),
  'utf8'
);

describe('tiposQueCabem', () => {
  const AGORA = new Date('2026-10-15T15:00:00Z');

  it('sem pagamento, a caminho, cancelado: nenhum botao', () => {
    expect(tiposQueCabem(posVendaDoPedido('aguardando_pagamento', null))).toEqual([]);
    expect(tiposQueCabem(posVendaDoPedido('enviado', null))).toEqual([]);
    expect(tiposQueCabem(posVendaDoPedido('cancelado', null))).toEqual([]);
    expect(tiposQueCabem(null)).toEqual([]);
  });

  it('pago ou em producao: so cancelar', () => {
    expect(tiposQueCabem(posVendaDoPedido('pago', null))).toEqual(['cancelamento']);
    expect(tiposQueCabem(posVendaDoPedido('em_producao', null))).toEqual(['cancelamento']);
  });

  it('entregue ontem: desistir, trocar e defeito', () => {
    const situacao = posVendaDoPedido('entregue', '2026-10-14T15:00:00Z', AGORA);
    expect(tiposQueCabem(situacao)).toEqual(['arrependimento', 'troca', 'defeito']);
  });

  it('o ultimo dia ainda conta inteiro', () => {
    const situacao = posVendaDoPedido('entregue', '2026-10-08T15:00:00Z', AGORA);
    expect(tiposQueCabem(situacao)).toEqual(['arrependimento', 'troca', 'defeito']);
  });

  it('passados os prazos, so defeito', () => {
    const situacao = posVendaDoPedido('entregue', '2026-10-01T15:00:00Z', AGORA);
    expect(tiposQueCabem(situacao)).toEqual(['defeito']);
  });

  it('entregue sem data registrada: os tres, como o banco', () => {
    expect(tiposQueCabem(posVendaDoPedido('entregue', null))).toEqual([
      'arrependimento',
      'troca',
      'defeito',
    ]);
  });
});

describe('a mesma regra do banco', () => {
  it('os mesmos tipos, na mesma grafia', () => {
    for (const tipo of TIPOS_POS_VENDA) expect(MIGRATION).toContain(`'${tipo}'`);
  });

  it('os prazos sao as constantes dos termos', () => {
    expect(MIGRATION).toContain(`+ ${ARREPENDIMENTO_DIAS} -- ARREPENDIMENTO_DIAS`);
    expect(MIGRATION).toContain(`+ ${TROCA_DE_TAMANHO_DIAS} -- TROCA_DE_TAMANHO_DIAS`);
  });

  it('o mesmo teto da mensagem', () => {
    expect(MIGRATION).toContain(`char_length(mensagem) between 1 and ${MENSAGEM_MAX}`);
  });

  it('cancelar so de pago e em producao', () => {
    expect(MIGRATION).toContain("when 'cancelamento' then o.status in ('pago', 'em_producao')");
  });
});

describe('mapeiaSolicitacoes', () => {
  it('da mais nova para a mais antiga, sem tipo desconhecido, mensagem vazia vira nula', () => {
    const lista = mapeiaSolicitacoes([
      {
        tipo: 'cancelamento',
        protocolo: 'PV-00000001',
        criado_em: '2026-10-10T10:00:00Z',
        resolvida_em: '2026-10-11T10:00:00Z',
        mensagem: '   ',
      },
      {
        tipo: 'extraviado',
        protocolo: 'PV-00000002',
        criado_em: '2026-10-12T10:00:00Z',
        resolvida_em: null,
        mensagem: null,
      },
      {
        tipo: 'defeito',
        protocolo: 'PV-00000003',
        criado_em: '2026-10-13T10:00:00Z',
        resolvida_em: null,
        mensagem: ' costura aberta ',
      },
    ]);

    expect(lista.map((s) => s.protocolo)).toEqual(['PV-00000003', 'PV-00000001']);
    expect(lista[0].mensagem).toBe('costura aberta');
    expect(lista[1].mensagem).toBeNull();
    // Sem id na linha, sem id na saida: a tela do cliente nao leva.
    expect('id' in lista[0]).toBe(false);
  });

  it('tiposAbertos: so as nao resolvidas', () => {
    const lista = mapeiaSolicitacoes([
      {
        tipo: 'troca',
        protocolo: 'PV-1',
        criado_em: '2026-10-10T10:00:00Z',
        resolvida_em: '2026-10-11T10:00:00Z',
        mensagem: null,
      },
      {
        tipo: 'defeito',
        protocolo: 'PV-2',
        criado_em: '2026-10-12T10:00:00Z',
        resolvida_em: null,
        mensagem: null,
      },
    ]);
    expect([...tiposAbertos(lista)]).toEqual(['defeito']);
  });
});

describe('textos', () => {
  it('os botoes que a issue pede', () => {
    expect(BOTAO_DO_TIPO.cancelamento).toBe('Pedir cancelamento');
    expect(BOTAO_DO_TIPO.arrependimento).toBe('Quero desistir da compra');
  });

  it('ehTipoPosVenda nao aceita heranca do prototipo', () => {
    expect(ehTipoPosVenda('constructor')).toBe(false);
    expect(ehTipoPosVenda('troca')).toBe(true);
  });
});
