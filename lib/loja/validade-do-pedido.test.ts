import { describe, expect, it } from 'vitest';
import {
  expirou,
  pagarAte,
  VALIDADE_DO_PEDIDO_MS,
  VALIDADE_MINIMA_DO_PIX_MS,
  validadeDoPix,
} from './validade-do-pedido';

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

describe('vencimento do Pix (#298)', () => {
  const FIM = NASCIDO + VALIDADE_DO_PEDIDO_MS;

  it('Pix aberto perto do fim vence junto com o pedido, nao 24 h depois', () => {
    expect(validadeDoPix(CRIADO, FIM - (5 * 60 + 12) * 60_000)).toBe('PT5H12M');
  });

  it('arredonda para baixo no minuto: nunca passa do prazo', () => {
    expect(validadeDoPix(CRIADO, FIM - 45 * 60_000 - 30_000)).toBe('PT45M');
  });

  it('pedido novo fica no teto de 24 h do provedor', () => {
    expect(validadeDoPix(CRIADO, NASCIDO)).toBe('PT24H');
  });

  it('com menos que o minimo do provedor, nao abre Pix', () => {
    expect(validadeDoPix(CRIADO, FIM - VALIDADE_MINIMA_DO_PIX_MS)).toBe('PT30M');
    expect(validadeDoPix(CRIADO, FIM - VALIDADE_MINIMA_DO_PIX_MS + 1)).toBeNull();
    expect(validadeDoPix(CRIADO, FIM)).toBeNull();
  });

  it('data ilegivel nao abre Pix', () => {
    expect(validadeDoPix('nao-e-data', NASCIDO)).toBeNull();
  });
});
