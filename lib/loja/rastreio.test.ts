import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FORMATO_DO_RASTREIO,
  leRastreio,
  normalizaRastreio,
  rastreioValido,
  urlDeRastreioValida,
} from './rastreio';

describe('normalizaRastreio', () => {
  it('tira espaco e quebra de linha e passa para maiusculas', () => {
    expect(normalizaRastreio(' ab 123 456 789 br\n')).toBe('AB123456789BR');
  });
});

describe('rastreioValido', () => {
  it.each(['AB123456789BR', 'QQ000000000CN'])('aceita %s', (c) => {
    expect(rastreioValido(c)).toBe(true);
  });

  it.each([
    'ab123456789br',
    'AB12345678BR',
    'AB1234567890BR',
    'A1123456789BR',
    'AB123456789B',
    '',
    'AB123456789BR ',
  ])('recusa %j', (c) => {
    expect(rastreioValido(c)).toBe(false);
  });

  it('e a mesma regra da check constraint do banco', () => {
    const sql = readFileSync(
      join(process.cwd(), 'supabase/migrations/20261015180000_codigo_de_rastreio.sql'),
      'utf8'
    );
    expect(sql).toContain(`rastreio_codigo ~ '${FORMATO_DO_RASTREIO.source}'`);
  });
});

describe('urlDeRastreioValida', () => {
  it('so https, sem espaco e com teto', () => {
    expect(urlDeRastreioValida('https://melhorrastreio.com.br/rastreio/AB123456789BR')).toBe(true);
    expect(urlDeRastreioValida('http://melhorrastreio.com.br/x')).toBe(false);
    expect(urlDeRastreioValida('javascript:alert(1)')).toBe(false);
    expect(urlDeRastreioValida('https://a.test/ x')).toBe(false);
    expect(urlDeRastreioValida(`https://a.test/${'x'.repeat(500)}`)).toBe(false);
    expect(urlDeRastreioValida('HTTPS://a.test/x')).toBe(false);
  });
});

describe('leRastreio', () => {
  it('sem codigo, sem bloco', () => {
    expect(leRastreio(null, 'https://a.test/x')).toBeNull();
  });

  it('codigo torto nao aparece como rastreavel', () => {
    expect(leRastreio('nao-e-codigo', null)).toBeNull();
  });

  it('url fora do padrao some, o codigo fica', () => {
    expect(leRastreio('AB123456789BR', 'http://a.test/x')).toEqual({
      codigo: 'AB123456789BR',
      url: null,
    });
    expect(leRastreio('AB123456789BR', 'https://a.test/x')).toEqual({
      codigo: 'AB123456789BR',
      url: 'https://a.test/x',
    });
  });
});
