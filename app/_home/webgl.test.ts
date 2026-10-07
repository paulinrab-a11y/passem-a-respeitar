// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { temWebGL } from './webgl';

/**
 * A sondagem que separa "aparelho sem 3D" de "bug na cena" (#238). O jsdom
 * nao tem WebGL nem canvas de verdade: `getContext` e substituido em cada
 * caso, e o que se prova e a leitura — qualquer contexto WebGL conta, nenhum
 * e `false`, um getContext que lanca e `false`, e o contexto de sondagem e
 * devolvido ao navegador.
 */
type Contexto = { getExtension: (nome: string) => { loseContext: () => void } | null };

function navegadorQueDa(contextos: Record<string, Contexto>) {
  return vi
    .spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockImplementation(((tipo: string) => contextos[tipo] ?? null) as never);
}

afterEach(() => vi.restoreAllMocks());

describe('temWebGL', () => {
  it('sem contexto nenhum, e false', () => {
    const getContext = navegadorQueDa({});

    expect(temWebGL(document)).toBe(false);
    // Tentou os tres nomes que o three tenta, nesta ordem.
    expect(getContext.mock.calls.map(([tipo]) => tipo)).toEqual([
      'webgl2',
      'webgl',
      'experimental-webgl',
    ]);
  });

  it('com webgl2, e true, para na primeira e solta o contexto de sondagem', () => {
    const loseContext = vi.fn();
    const gl = { getExtension: vi.fn(() => ({ loseContext })) };
    const getContext = navegadorQueDa({ webgl2: gl, webgl: gl });

    expect(temWebGL(document)).toBe(true);
    expect(getContext).toHaveBeenCalledTimes(1);
    expect(getContext).toHaveBeenCalledWith('webgl2');
    expect(gl.getExtension).toHaveBeenCalledWith('WEBGL_lose_context');
    expect(loseContext).toHaveBeenCalledOnce();
  });

  it('so com webgl 1, tambem e true: o three aceita os dois', () => {
    navegadorQueDa({ webgl: { getExtension: () => null } });

    expect(temWebGL(document)).toBe(true);
  });

  it('um getContext que lanca e um navegador sem WebGL, nao um bug da cena', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
      throw new Error('WebGL bloqueado pela politica');
    });

    expect(temWebGL(document)).toBe(false);
  });

  it('sem argumento, usa o documento da pagina', () => {
    navegadorQueDa({ webgl2: { getExtension: () => null } });

    expect(temWebGL()).toBe(true);
  });
});
