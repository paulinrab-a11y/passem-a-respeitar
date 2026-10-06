// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { esqueceCep, lembraCep, useCepLembrado } from './cep-lembrado';

/**
 * O CEP lembrado (#205): um valor, dois lugares na tela, e o navegador guarda.
 */
beforeEach(() => esqueceCep());
// Desmontar antes de esquecer: um hook ainda montado seria avisado pelo
// esquecimento e leria o armazenamento vazio, guardando o vazio na memoria.
afterEach(() => {
  cleanup();
  esqueceCep();
});

describe('o CEP lembrado', () => {
  it('comeca vazio', () => {
    const { result } = renderHook(() => useCepLembrado());
    expect(result.current).toBe('');
  });

  it('guarda so digitos, no maximo oito', () => {
    const { result } = renderHook(() => useCepLembrado());
    act(() => lembraCep('01310-100'));
    expect(result.current).toBe('01310100');

    act(() => lembraCep('01310-1009'));
    expect(result.current).toBe('01310100');
  });

  it('dois lugares veem o mesmo valor', () => {
    const a = renderHook(() => useCepLembrado());
    const b = renderHook(() => useCepLembrado());

    act(() => lembraCep('04538133'));

    expect(a.result.current).toBe('04538133');
    expect(b.result.current).toBe('04538133');
  });

  it('fica no navegador, e volta numa visita nova', () => {
    act(() => lembraCep('04538133'));
    expect(window.localStorage.getItem('par_cep')).toBe('04538133');

    // Uma pagina nova: o modulo esquece a memoria, mas nao o armazenamento.
    esqueceCepNaMemoria();
    const { result } = renderHook(() => useCepLembrado());
    expect(result.current).toBe('04538133');
  });

  it('apagar o campo apaga o que estava guardado', () => {
    act(() => lembraCep('04538133'));
    act(() => lembraCep(''));
    expect(window.localStorage.getItem('par_cep')).toBeNull();
  });

  it('o mesmo valor de novo nao acorda ninguem', () => {
    const { result } = renderHook(() => useCepLembrado());
    let renders = 0;
    renderHook(() => {
      renders += 1;
      return useCepLembrado();
    });
    act(() => lembraCep('04538133'));
    const antes = renders;
    act(() => lembraCep('04538-133'));
    expect(renders).toBe(antes);
    expect(result.current).toBe('04538133');
  });
});

/** Simula a pagina seguinte: a memoria do modulo zera, o localStorage fica. */
function esqueceCepNaMemoria() {
  const guardado = window.localStorage.getItem('par_cep');
  esqueceCep();
  if (guardado) window.localStorage.setItem('par_cep', guardado);
}
