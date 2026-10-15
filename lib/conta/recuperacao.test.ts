import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { criaMarcaDeRecuperacao, marcaDeRecuperacaoConfere } from './recuperacao';

/**
 * A marca da recuperacao (#348): so vale para a conta que recebeu o link, so
 * por meia hora e so com a assinatura do servidor.
 */
const CONTA = '11111111-1111-4111-8111-111111111111';
const OUTRA = '22222222-2222-4222-8222-222222222222';
const AGORA_S = 1_800_000_000;
const AGORA_MS = AGORA_S * 1000;

beforeEach(() => {
  vi.stubEnv('SUPABASE_SECRET_KEY', 'sb_secret_de_teste');
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('marca da recuperacao', () => {
  it('confere para a conta que a recebeu', () => {
    const marca = criaMarcaDeRecuperacao(CONTA, AGORA_S);
    expect(marca).toMatch(/^v1\.[0-9a-f-]{36}\.\d+\.[0-9a-f]{64}$/);
    expect(marcaDeRecuperacaoConfere(marca ?? '', CONTA, AGORA_MS)).toBe(true);
  });

  it('nao vale para outra conta no mesmo navegador', () => {
    const marca = criaMarcaDeRecuperacao(CONTA, AGORA_S) ?? '';
    expect(marcaDeRecuperacaoConfere(marca, OUTRA, AGORA_MS)).toBe(false);
  });

  it('vence em meia hora, mesmo que o cookie continue no navegador', () => {
    const marca = criaMarcaDeRecuperacao(CONTA, AGORA_S) ?? '';
    expect(marcaDeRecuperacaoConfere(marca, CONTA, AGORA_MS + 29 * 60_000)).toBe(true);
    expect(marcaDeRecuperacaoConfere(marca, CONTA, AGORA_MS + 30 * 60_000)).toBe(false);
  });

  it('trocar o id ou o vencimento quebra a assinatura', () => {
    const [v, , vence, hmac] = (criaMarcaDeRecuperacao(CONTA, AGORA_S) ?? '').split('.');
    expect(marcaDeRecuperacaoConfere(`${v}.${OUTRA}.${vence}.${hmac}`, OUTRA, AGORA_MS)).toBe(
      false
    );
    const depois = Number(vence) + 3600;
    expect(marcaDeRecuperacaoConfere(`${v}.${CONTA}.${depois}.${hmac}`, CONTA, AGORA_MS)).toBe(
      false
    );
  });

  it('assinada com outro segredo nao vale', () => {
    vi.stubEnv('SUPABASE_SECRET_KEY', 'segredo-do-atacante');
    const forjada = criaMarcaDeRecuperacao(CONTA, AGORA_S) ?? '';
    vi.stubEnv('SUPABASE_SECRET_KEY', 'sb_secret_de_teste');
    expect(marcaDeRecuperacaoConfere(forjada, CONTA, AGORA_MS)).toBe(false);
  });

  it('o valor antigo, `1`, e lixo nao valem', () => {
    for (const valor of ['1', '', 'v1', 'v1.a.b.c', `v1.${CONTA}.x.y`, undefined]) {
      expect(marcaDeRecuperacaoConfere(valor, CONTA, AGORA_MS)).toBe(false);
    }
  });

  it('sem segredo no servidor, a marca nao nasce nem confere', () => {
    const marca = criaMarcaDeRecuperacao(CONTA, AGORA_S) ?? '';
    vi.stubEnv('SUPABASE_SECRET_KEY', '');
    expect(criaMarcaDeRecuperacao(CONTA, AGORA_S)).toBeNull();
    expect(marcaDeRecuperacaoConfere(marca, CONTA, AGORA_MS)).toBe(false);
  });

  it('id que nao e uuid nao recebe marca', () => {
    expect(criaMarcaDeRecuperacao('nao-e-uuid.com.ponto', AGORA_S)).toBeNull();
  });
});
