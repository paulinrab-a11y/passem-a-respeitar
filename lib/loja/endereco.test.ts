import { describe, expect, it } from 'vitest';
import {
  cepLegivel,
  type Endereco,
  enderecoEmUmaLinha,
  esquemaEndereco,
  paraColunas,
  soDigitos,
} from './endereco';

const VALIDO = {
  nome: 'Fulano de Teste',
  cep: '01310-100',
  logradouro: 'Avenida Paulista',
  numero: '1578',
  complemento: 'apto 92',
  bairro: 'Bela Vista',
  cidade: 'São Paulo',
  uf: 'SP',
};

const ok = (bruto: unknown): Endereco => esquemaEndereco.parse(bruto);

describe('soDigitos', () => {
  it.each([
    ['01310-100', '01310100'],
    ['01310 100', '01310100'],
    ['01310100', '01310100'],
    ['  01310-100  ', '01310100'],
  ])('%s vira %s', (bruto, esperado) => {
    expect(soDigitos(bruto)).toBe(esperado);
  });
});

describe('cepLegivel', () => {
  it('poe o hifen de volta para a tela', () => {
    expect(cepLegivel('01310100')).toBe('01310-100');
  });

  it('deixa passar o que nao e CEP em vez de inventar formato', () => {
    expect(cepLegivel('123')).toBe('123');
  });
});

describe('esquemaEndereco', () => {
  it('aceita um endereco normal e normaliza o CEP', () => {
    const e = ok(VALIDO);

    expect(e.cep).toBe('01310100');
    expect(e.uf).toBe('SP');
    expect(e.logradouro).toBe('Avenida Paulista');
  });

  it('aceita UF em minuscula e devolve maiuscula', () => {
    expect(ok({ ...VALIDO, uf: 'sp' }).uf).toBe('SP');
  });

  // "XX" tem a forma que o banco aceita (duas maiusculas) e nao e estado. A
  // forma e do banco; a validade e daqui.
  it.each(['XX', 'ZZ', 'BR', 'S', 'SPP'])('recusa UF inexistente: %s', (uf) => {
    expect(esquemaEndereco.safeParse({ ...VALIDO, uf }).success).toBe(false);
  });

  it('aceita todas as 27 siglas', () => {
    const todas = [
      'AC',
      'AL',
      'AP',
      'AM',
      'BA',
      'CE',
      'DF',
      'ES',
      'GO',
      'MA',
      'MT',
      'MS',
      'MG',
      'PA',
      'PB',
      'PR',
      'PE',
      'PI',
      'RJ',
      'RN',
      'RS',
      'RO',
      'RR',
      'SC',
      'SP',
      'SE',
      'TO',
    ];

    expect(todas).toHaveLength(27);
    for (const uf of todas) {
      expect(esquemaEndereco.safeParse({ ...VALIDO, uf }).success).toBe(true);
    }
  });

  // String vazia no banco seria um terceiro estado sem significado.
  it.each([
    ['ausente', undefined],
    ['vazio', ''],
    ['so espaco', '   '],
    ['nulo', null],
  ])('complemento %s vira null', (_caso, complemento) => {
    expect(ok({ ...VALIDO, complemento }).complemento).toBeNull();
  });

  it('tira espaco das pontas', () => {
    const e = ok({ ...VALIDO, nome: '  Fulano  ', cidade: '  São Paulo ' });

    expect(e.nome).toBe('Fulano');
    expect(e.cidade).toBe('São Paulo');
  });

  it.each([
    ['CEP curto', { cep: '0131010' }],
    ['CEP comprido', { cep: '013101000' }],
    ['CEP com letra', { cep: '0131010A' }],
    ['CEP vazio', { cep: '' }],
    ['nome de uma letra', { nome: 'F' }],
    ['nome comprido demais', { nome: 'x'.repeat(121) }],
    ['logradouro vazio', { logradouro: '' }],
    ['numero vazio', { numero: '' }],
    ['bairro vazio', { bairro: '' }],
    ['cidade vazia', { cidade: '' }],
    ['complemento comprido demais', { complemento: 'x'.repeat(81) }],
  ])('recusa %s', (_caso, campo) => {
    expect(esquemaEndereco.safeParse({ ...VALIDO, ...campo }).success).toBe(false);
  });

  // Os limites daqui batem com os check constraints da migration. Se
  // divergissem, o formulario aprovaria e o banco recusaria depois.
  it('aceita exatamente no limite de cada campo', () => {
    const noLimite = {
      ...VALIDO,
      nome: 'x'.repeat(120),
      logradouro: 'x'.repeat(160),
      numero: 'x'.repeat(20),
      complemento: 'x'.repeat(80),
      bairro: 'x'.repeat(80),
      cidade: 'x'.repeat(80),
    };

    expect(esquemaEndereco.safeParse(noLimite).success).toBe(true);
  });

  // Anti mass assignment (#19): o parse descarta o que nao esta no schema.
  it('descarta campo que o schema nao declara', () => {
    const analisado = esquemaEndereco.parse({
      ...VALIDO,
      user_id: '00000000-0000-4000-8000-000000000000',
      total_centavos: 1,
      entrega_uf: 'RJ',
      anonimizado_em: null,
    });

    expect(Object.keys(analisado).sort()).toEqual([
      'bairro',
      'cep',
      'cidade',
      'complemento',
      'logradouro',
      'nome',
      'numero',
      'uf',
    ]);
  });
});

describe('paraColunas', () => {
  it('traduz para os nomes de coluna de orders', () => {
    expect(paraColunas(ok(VALIDO))).toEqual({
      entrega_nome: 'Fulano de Teste',
      entrega_cep: '01310100',
      entrega_logradouro: 'Avenida Paulista',
      entrega_numero: '1578',
      entrega_complemento: 'apto 92',
      entrega_bairro: 'Bela Vista',
      entrega_cidade: 'São Paulo',
      entrega_uf: 'SP',
    });
  });

  // O que sai daqui vira `update` em orders: uma chave a mais seria uma coluna
  // escrita sem ninguem decidir.
  it('nao inventa coluna nenhuma', () => {
    expect(Object.keys(paraColunas(ok(VALIDO))).every((k) => k.startsWith('entrega_'))).toBe(true);
  });

  it('o CEP chega no banco so com digitos, como o check exige', () => {
    expect(paraColunas(ok({ ...VALIDO, cep: '01310-100' })).entrega_cep).toBe('01310100');
  });
});

describe('enderecoEmUmaLinha', () => {
  it('monta a linha do resumo', () => {
    expect(enderecoEmUmaLinha(paraColunas(ok(VALIDO)))).toBe(
      'Avenida Paulista, 1578, apto 92 — Bela Vista, São Paulo/SP — 01310-100'
    );
  });

  it('sem complemento nao deixa virgula sobrando', () => {
    const sem = paraColunas(ok({ ...VALIDO, complemento: '' }));

    expect(enderecoEmUmaLinha(sem)).toBe(
      'Avenida Paulista, 1578 — Bela Vista, São Paulo/SP — 01310-100'
    );
  });
});
