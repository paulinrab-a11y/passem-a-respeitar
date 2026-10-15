import { describe, expect, it } from 'vitest';
import { forcaDaSenha, SENHA_MIN } from './senha';

const nivel = (s: string) => forcaDaSenha(s).nivel;

describe('forcaDaSenha', () => {
  it('com o campo vazio, diz o minimo antes de qualquer erro (#376)', () => {
    expect(forcaDaSenha('')).toEqual({ nivel: 0, rotulo: `mínimo ${SENHA_MIN} caracteres` });
  });

  it('enquanto falta comprimento, diz quanto falta', () => {
    expect(forcaDaSenha('abc')).toEqual({ nivel: 0, rotulo: `faltam ${SENHA_MIN - 3}` });
    expect(forcaDaSenha('a'.repeat(SENHA_MIN - 1)).rotulo).toBe('faltam 1');
  });

  // O que de fato move a agulha e comprimento, e o medidor precisa dizer isso
  // — senao ensina a pessoa a escolher errado.
  it('comprimento vale mais que variedade de simbolos', () => {
    // Quatro tipos de caractere, curta e com padrao obvio.
    const curtaComplicada = nivel('Senha1!a');
    // So minusculas, mas longa.
    const longaSimples = nivel('cavalo bateria grampo correto');

    expect(longaSimples).toBeGreaterThan(curtaComplicada);
  });

  it('cresce com o tamanho', () => {
    expect(nivel('krtpwzmq')).toBeLessThan(nivel('krtpwzmqfxdl'));
    expect(nivel('krtpwzmqfxdl')).toBeLessThanOrEqual(nivel('krtpwzmqfxdlvbnh'));
  });

  it('nao passa de 4', () => {
    expect(nivel('x9$Kq2#mZp7!wLn4@vTb8&rYc1')).toBeLessThanOrEqual(4);
  });

  // Estas aparecem em qualquer lista de vazamento com o nome do EP junto.
  it.each(['passemarespeitar', 'Santxx2026!', 'whynotvisuals1'])('desconta "%s"', (s) => {
    expect(nivel(s)).toBeLessThanOrEqual(2);
  });

  it('desconta sequencia de teclado', () => {
    expect(nivel('qwertyuiop123')).toBeLessThan(nivel('mzxbvlkqjtrp1'));
  });

  it('desconta sequencia invertida', () => {
    expect(nivel('0987654321ab')).toBeLessThan(nivel('mzxbvlkqjtrp'));
  });

  it('desconta caractere repetido', () => {
    expect(nivel('aaaaaaaaaaaa')).toBe(0);
  });

  it('sempre devolve rotulo quando ha nivel', () => {
    for (const s of ['krtpwzmq', 'krtpwzmqfx', 'krtpwzmqfxdlvb', 'x9$Kq2#mZp7!wLn4@vTb8&rYc1']) {
      expect(forcaDaSenha(s).rotulo).not.toBe('');
    }
  });
});
