import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Quem vende (#276). Os dados de verdade nunca entram num teste: os valores
 * aqui sao inventados, e o que se prova e a regra — os tres juntos ou nada, e
 * em producao, sem eles, nada de cobranca.
 */
const captureMessage = vi.fn();
vi.mock('@sentry/nextjs', () => ({
  captureMessage: (...a: unknown[]) => captureMessage(...a),
  flush: async () => true,
}));
const enviaDepois = vi.fn();
vi.mock('@/lib/sentry/depois', () => ({ enviaDepois: () => enviaDepois() }));

const { dadosDoVendedor, vendaLiberada } = await import('./vendedor');

const NOME = 'Loja de Teste Ltda';
const CNPJ = '00.000.000/0001-00';
const ENDERECO = 'Rua de Teste, 1, Bairro, Cidade - UF, 00000-000';

function cadastra(nome = NOME, documento = CNPJ, endereco = ENDERECO) {
  vi.stubEnv('VENDEDOR_NOME', nome);
  vi.stubEnv('VENDEDOR_DOCUMENTO', documento);
  vi.stubEnv('VENDEDOR_ENDERECO', endereco);
}

beforeEach(() => {
  captureMessage.mockClear();
  enviaDepois.mockClear();
  // A maquina de quem roda o teste pode ter as variaveis no ambiente: aqui
  // cada teste comeca sem nenhuma.
  cadastra('', '', '');
  vi.stubEnv('VERCEL_ENV', '');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('dadosDoVendedor', () => {
  it('os tres cadastrados voltam como estao, sem espaco sobrando', () => {
    cadastra(`  ${NOME} `, ` ${CNPJ}`, `${ENDERECO}  `);

    expect(dadosDoVendedor()).toEqual({
      nome: NOME,
      documento: CNPJ,
      tipoDoDocumento: 'CNPJ',
      endereco: ENDERECO,
    });
  });

  it.each([
    ['sem nome', '', CNPJ, ENDERECO],
    ['sem documento', NOME, '', ENDERECO],
    ['sem endereco', NOME, CNPJ, ''],
    ['so espaco no nome', '   ', CNPJ, ENDERECO],
  ])('%s: nada — meia identificacao nao e identificacao', (_, nome, documento, endereco) => {
    cadastra(nome, documento, endereco);

    expect(dadosDoVendedor()).toBeNull();
  });

  // O rotulo sai da contagem de digitos, com ou sem pontuacao. Fora de 11 e
  // 14, o documento sai como o dono escreveu, sem rotulo inventado.
  it.each([
    ['000.000.000-00', 'CPF'],
    ['00000000000', 'CPF'],
    ['00.000.000/0001-00', 'CNPJ'],
    ['00000000000100', 'CNPJ'],
    ['123', 'CPF ou CNPJ'],
  ])('%s e %s', (documento, tipo) => {
    cadastra(NOME, documento);

    expect(dadosDoVendedor()?.tipoDoDocumento).toBe(tipo);
    expect(dadosDoVendedor()?.documento).toBe(documento);
  });
});

describe('vendaLiberada', () => {
  it('em producao, sem os dados, nao vende, e avisa o dono', () => {
    vi.stubEnv('VERCEL_ENV', 'production');

    expect(vendaLiberada()).toBe(false);
    expect(captureMessage).toHaveBeenCalledWith(
      'venda bloqueada: faltam os dados de quem vende',
      expect.objectContaining({ level: 'error' })
    );
    expect(enviaDepois).toHaveBeenCalled();
  });

  it('em producao, com metade dos dados, tambem nao', () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    cadastra(NOME, CNPJ, '');

    expect(vendaLiberada()).toBe(false);
  });

  it('em producao, com os tres, vende, e nao avisa nada', () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    cadastra();

    expect(vendaLiberada()).toBe(true);
    expect(captureMessage).not.toHaveBeenCalled();
  });

  // Preview e desenvolvimento cobram no Mercado Pago de teste: travar ali so
  // atrapalharia quem testa.
  it.each(['preview', 'development', ''])('em %j, sem os dados, segue vendendo', (ambiente) => {
    vi.stubEnv('VERCEL_ENV', ambiente);

    expect(vendaLiberada()).toBe(true);
    expect(captureMessage).not.toHaveBeenCalled();
  });

  // O aviso diz o fato, nunca o dado: nem o que esta cadastrado, nem o nome
  // de qual variavel falta.
  it('o aviso nao leva dado nenhum', () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    cadastra(NOME, '', ENDERECO);
    vendaLiberada();

    const enviado = JSON.stringify(captureMessage.mock.calls);
    expect(enviado).not.toContain(NOME);
    expect(enviado).not.toContain(ENDERECO);
    expect(enviado).not.toMatch(/VENDEDOR_/);
  });
});
