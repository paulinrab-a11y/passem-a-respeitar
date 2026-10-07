import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A redefinicao so existe para quem chegou pelo link. O que se prova: sem
 * sessao nada acontece; com sessao, a senha passa pela politica, e trocada,
 * e as OUTRAS sessoes caem.
 */
const updateUser = vi.fn(async (_o: unknown) => ({ error: null as { message: string } | null }));
const signOut = vi.fn(async (_o: unknown) => ({ error: null }));
const senhaVazada = vi.fn(async (_s: string) => false);
let usuario: { id: string } | null = null;
// O jar de cookies do request: a marca da recuperacao (#234) mora aqui.
const jar = new Map<string, string>();

vi.mock('@/lib/supabase/servidor', () => ({
  usuarioDaSessao: async () => usuario,
  clienteDeAuth: async () => ({ auth: { updateUser, signOut } }),
}));
vi.mock('@/lib/conta/senha-servidor', () => ({ senhaVazada: (s: string) => senhaVazada(s) }));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (nome: string) => (jar.has(nome) ? { name: nome, value: jar.get(nome) } : undefined),
    delete: (nome: string) => jar.delete(nome),
  }),
}));
vi.mock('next/navigation', () => ({
  redirect: (d: string) => {
    throw new Error(`redirect:${d}`);
  },
}));

const { redefinirSenha } = await import('./acoes');
const { redefinirInicial } = await import('./estado');

let n = 0;

function formulario(campos: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.set(k, v);
  return f;
}

const envia = (campos: Record<string, string> = {}) =>
  redefinirSenha(
    redefinirInicial,
    formulario({ nova: 'tres palavras soltas', confirmacao: 'tres palavras soltas', ...campos })
  );

beforeEach(() => {
  vi.clearAllMocks();
  updateUser.mockResolvedValue({ error: null });
  senhaVazada.mockResolvedValue(false);
  // Usuario novo por teste: o limite por conta guarda estado no modulo.
  usuario = { id: `11111111-1111-4111-8111-${String(n++).padStart(12, '0')}` };
  jar.clear();
  jar.set('par_recuperacao', '1');
});

describe('com a sessao do link', () => {
  it('troca a senha, derruba as outras sessoes, apaga a marca e vai para a conta', async () => {
    await expect(envia()).rejects.toThrow('redirect:/conta');

    expect(updateUser).toHaveBeenCalledWith({ password: 'tres palavras soltas' });
    expect(signOut).toHaveBeenCalledWith({ scope: 'others' });
    expect(jar.has('par_recuperacao')).toBe(false);
    expect(updateUser.mock.invocationCallOrder[0]).toBeLessThan(
      signOut.mock.invocationCallOrder[0]
    );
  });

  it('senha curta nao troca', async () => {
    const r = await envia({ nova: 'curta', confirmacao: 'curta' });
    expect(r.campo).toBe('nova');
    expect(updateUser).not.toHaveBeenCalled();
  });

  it('confirmacao diferente nao troca', async () => {
    const r = await envia({ confirmacao: 'outra coisa' });
    expect(r.campo).toBe('confirmacao');
    expect(updateUser).not.toHaveBeenCalled();
  });

  it('senha vazada nao troca', async () => {
    senhaVazada.mockResolvedValue(true);
    const r = await envia();
    expect(r.erro).toMatch(/vazamentos/i);
    expect(updateUser).not.toHaveBeenCalled();
  });

  it('erro do provedor nao derruba sessao nenhuma', async () => {
    updateUser.mockResolvedValue({ error: { message: 'x' } });
    const r = await envia();
    expect(r.erro).toMatch(/não consegui/i);
    expect(signOut).not.toHaveBeenCalled();
  });

  it('para depois de cinco tentativas na conta', async () => {
    usuario = { id: '11111111-1111-4111-8111-999999999999' };
    updateUser.mockResolvedValue({ error: { message: 'x' } });
    for (let i = 0; i < 5; i++) await envia();
    const r = await envia();
    expect(r.erro).toMatch(/muitas tentativas/i);
  });
});

describe('sessao comum, sem a marca da recuperacao (#234)', () => {
  it('nao troca nada: a troca normal e em Seguranca, com a senha atual', async () => {
    jar.delete('par_recuperacao');
    const r = await envia();

    expect(r.erro).toMatch(/não vale mais/i);
    expect(updateUser).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
  });
});

describe('sem sessao', () => {
  it('nao troca nada e manda pedir outro link', async () => {
    usuario = null;
    const r = await envia();

    expect(r.erro).toMatch(/não vale mais/i);
    expect(updateUser).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
  });
});
