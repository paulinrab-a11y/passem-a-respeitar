import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `usuarioDaSessao` uma vez por renderizacao (#374).
 *
 * O `cache()` do React so memoiza dentro de uma renderizacao de Server
 * Component; no Vitest o React e o do navegador, onde ele so repassa. Aqui ele
 * vira um `cache()` que guarda de verdade, como o do servidor durante uma
 * renderizacao, e o teste confere que a funcao passa por ele.
 */
const { getUser, envolvidas } = vi.hoisted(() => ({
  getUser: vi.fn(),
  envolvidas: [] as unknown[],
}));

vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  cache: <A extends unknown[], R>(fn: (...a: A) => R) => {
    envolvidas.push(fn);
    let guardado: { valor: R } | null = null;
    return (...a: A) => {
      guardado ??= { valor: fn(...a) };
      return guardado.valor;
    };
  },
}));

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ auth: { getUser } }),
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({ getAll: () => [], get: () => undefined, set: () => undefined }),
  headers: async () => new Headers(),
}));

beforeEach(() => {
  getUser.mockReset();
  getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
});

describe('usuarioDaSessao na renderizacao', () => {
  it('passa pelo cache() do React', async () => {
    await import('./servidor');
    expect(envolvidas).toHaveLength(1);
  });

  it('duas chamadas na mesma renderizacao, uma ida ao Supabase Auth', async () => {
    const { usuarioDaSessao } = await import('./servidor');

    const [a, b] = await Promise.all([usuarioDaSessao(), usuarioDaSessao()]);
    const c = await usuarioDaSessao();

    expect(a).toEqual({ id: 'u1' });
    expect(b).toBe(a);
    expect(c).toBe(a);
    expect(getUser).toHaveBeenCalledTimes(1);
  });
});
