import { describe, expect, it } from 'vitest';
import { expirou, pagarAte, VALIDADE_DO_PEDIDO_MS } from './validade-do-pedido';

const CRIADO = '2026-10-10T12:00:00.000Z';
const NASCIDO = Date.parse(CRIADO);

describe('prazo para pagar o pedido (#298)', () => {
  it('pagarAte e a criacao mais a validade', () => {
    expect(pagarAte(CRIADO)).toBe(new Date(NASCIDO + VALIDADE_DO_PEDIDO_MS).toISOString());
  });

  it('um instante antes do fim ainda nao expirou', () => {
    expect(expirou(CRIADO, NASCIDO + VALIDADE_DO_PEDIDO_MS - 1)).toBe(false);
  });

  it('no fim do prazo, expirou', () => {
    expect(expirou(CRIADO, NASCIDO + VALIDADE_DO_PEDIDO_MS)).toBe(true);
  });

  // Data torta e bug nosso, e bug nosso nao pode cancelar pedido de ninguem.
  it('data ilegivel nao expira nem quebra a tela', () => {
    expect(expirou('nao-e-data', NASCIDO + 10 * VALIDADE_DO_PEDIDO_MS)).toBe(false);
    expect(pagarAte('nao-e-data')).toBeNull();
  });
});
