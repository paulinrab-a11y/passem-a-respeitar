import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ehStatusPedido,
  origensDe,
  proximosDe,
  STATUS_PEDIDO,
  type StatusPedido,
  transicaoPermitida,
} from './status-do-pedido';

describe('transicoes', () => {
  // O caminho feliz da camiseta.
  it.each<[StatusPedido, StatusPedido]>([
    ['pago', 'em_producao'],
    ['em_producao', 'enviado'],
    ['enviado', 'entregue'],
  ])('%s -> %s e permitida', (de, para) => {
    expect(transicaoPermitida(de, para)).toBe(true);
  });

  // O criterio da Issue: nao pula etapa.
  it('nao pula de pago direto para entregue', () => {
    expect(transicaoPermitida('pago', 'entregue')).toBe(false);
    expect(transicaoPermitida('pago', 'enviado')).toBe(false);
  });

  // Pagamento e do provedor. Uma pessoa marcando "pago" na mao e mercadoria
  // saindo sem dinheiro entrando.
  it('ninguem marca pago na mao, de status nenhum', () => {
    for (const de of STATUS_PEDIDO) {
      expect(transicaoPermitida(de, 'pago')).toBe(false);
    }
  });

  it('nao se despaga um pedido', () => {
    for (const de of STATUS_PEDIDO) {
      expect(transicaoPermitida(de, 'aguardando_pagamento')).toBe(false);
    }
  });

  it.each<StatusPedido>(['cancelado', 'reembolsado'])('%s e final', (de) => {
    expect(proximosDe(de)).toEqual([]);
  });

  it('cancelar vale antes de enviar, reembolsar vale depois de pagar', () => {
    expect(transicaoPermitida('aguardando_pagamento', 'cancelado')).toBe(true);
    expect(transicaoPermitida('aguardando_pagamento', 'reembolsado')).toBe(false);
    expect(transicaoPermitida('enviado', 'cancelado')).toBe(false);
    expect(transicaoPermitida('enviado', 'reembolsado')).toBe(true);
    expect(transicaoPermitida('entregue', 'reembolsado')).toBe(true);
  });

  it('o mesmo status nao e transicao', () => {
    for (const s of STATUS_PEDIDO) expect(transicaoPermitida(s, s)).toBe(false);
  });

  // A tabela lida ao contrario: e o que a automacao usa para saber que
  // pedidos um estorno no provedor alcanca (#7) — e nenhum a mais.
  it('origensDe e a tabela ao contrario', () => {
    expect(origensDe('reembolsado')).toEqual(['pago', 'em_producao', 'enviado', 'entregue']);
    expect(origensDe('cancelado')).toEqual(['aguardando_pagamento', 'pago', 'em_producao']);
    expect(origensDe('pago')).toEqual([]);
    expect(origensDe('aguardando_pagamento')).toEqual([]);

    for (const para of STATUS_PEDIDO) {
      for (const de of origensDe(para)) expect(transicaoPermitida(de, para)).toBe(true);
    }
  });
});

describe('ehStatusPedido', () => {
  it('reconhece os do enum e recusa o resto', () => {
    expect(ehStatusPedido('enviado')).toBe(true);
    expect(ehStatusPedido('ENVIADO')).toBe(false);
    expect(ehStatusPedido('constructor')).toBe(false);
    expect(ehStatusPedido(null)).toBe(false);
  });
});

/**
 * A tabela vive em dois lugares — aqui e em SQL — e os dois tem que dizer a
 * mesma coisa. Este teste le a migration e reconstroi a tabela dela. Se
 * alguem mudar um lado e esquecer o outro, cai aqui, nao em producao.
 */
describe('a tabela em SQL e a mesma', () => {
  const sql = readFileSync(
    join(__dirname, '..', '..', 'supabase', 'migrations', '20260925120000_muda_status_pedido.sql'),
    'utf8'
  );

  const linhas = [...sql.matchAll(/\(v_de = '(\w+)'\s+and p_para in \(([^)]*)\)\)/g)];

  it('acha a tabela na migration', () => {
    expect(linhas.length).toBeGreaterThan(0);
  });

  it('cada origem tem exatamente os mesmos destinos', () => {
    const doSql = new Map<string, string[]>();
    for (const [, de, lista] of linhas) {
      doSql.set(
        de,
        lista.split(',').map((s) => s.trim().replace(/'/g, ''))
      );
    }

    for (const de of STATUS_PEDIDO) {
      const esperado = [...proximosDe(de)].sort();
      const noSql = [...(doSql.get(de) ?? [])].sort();
      expect({ de, destinos: noSql }).toEqual({ de, destinos: esperado });
    }
  });
});
