import { describe, expect, it } from 'vitest';
import { RECUSA_GENERICA, recadoDaRecusa } from './recusa-do-cartao';

/**
 * A recusa do cartao em portugues (#365). O que se prova: cada motivo que o
 * Mercado Pago documenta tem frase propria, toda frase oferece Pix, e nada do
 * que vem do provedor chega a tela.
 */

const MOTIVOS = [
  ['cc_rejected_bad_filled_security_code', /código de segurança/],
  ['cc_rejected_bad_filled_date', /validade/],
  ['cc_rejected_bad_filled_card_number', /número do cartão/],
  ['cc_rejected_bad_filled_other', /Algum dado do cartão/],
  ['cc_rejected_insufficient_amount', /limite/],
  ['cc_rejected_call_for_authorize', /autorizar/],
  ['cc_rejected_card_disabled', /bloqueado/],
  ['cc_rejected_duplicated_payment', /igual a este/],
  ['cc_rejected_high_risk', /análise de segurança/],
  ['cc_rejected_max_attempts', /tentativas/],
  ['cc_rejected_other_reason', /banco do cartão recusou/],
  ['cc_rejected_blacklist', /não pode ser usado aqui/],
] as const;

describe('recadoDaRecusa', () => {
  it.each(MOTIVOS)('%s tem frase propria', (detalhe, frase) => {
    const texto = recadoDaRecusa(detalhe);

    expect(texto).toMatch(frase);
    expect(texto).not.toBe(RECUSA_GENERICA);
  });

  it.each(MOTIVOS)('%s sem o prefixo cc_rejected_ da a mesma frase', (detalhe) => {
    expect(recadoDaRecusa(detalhe.replace('cc_rejected_', ''))).toBe(recadoDaRecusa(detalhe));
  });

  it.each([
    ['required_call_for_authorize', 'cc_rejected_call_for_authorize'],
    ['max_attempts_exceeded', 'cc_rejected_max_attempts'],
    ['rejected_other_reason', 'cc_rejected_other_reason'],
    ['bad_filled_card_data', 'cc_rejected_bad_filled_other'],
  ])('o nome da Orders API %s vale como %s', (orders, payments) => {
    expect(recadoDaRecusa(orders)).toBe(recadoDaRecusa(payments));
  });

  it('toda frase oferece o Pix', () => {
    for (const [detalhe] of MOTIVOS) expect(recadoDaRecusa(detalhe)).toContain('Pix');
    expect(RECUSA_GENERICA).toContain('Pix');
  });

  it.each([
    [null],
    [undefined],
    [''],
    ['cc_rejected_algo_novo'],
    ['constructor'],
    ['__proto__'],
    ['<script>alert(1)</script>'],
  ])('%j vira a frase generica, e nada do que veio de fora', (detalhe) => {
    const texto = recadoDaRecusa(detalhe);

    expect(texto).toBe(RECUSA_GENERICA);
    if (detalhe) expect(texto).not.toContain(detalhe);
  });

  it('maiusculas e espaco em volta nao mudam o motivo', () => {
    expect(recadoDaRecusa('  CC_REJECTED_INSUFFICIENT_AMOUNT ')).toBe(
      recadoDaRecusa('cc_rejected_insufficient_amount')
    );
  });
});
