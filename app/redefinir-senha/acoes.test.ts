import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A redefinicao so existe para quem chegou pelo link. O que se prova: sem
 * sessao nada acontece; com sessao, a senha passa pela politica, e trocada,
 * e as OUTRAS sessoes caem.
 */
const updateUser = vi.fn(async (_o: unknown) => ({ error: null as { message: string } | null }));
const signOut = vi.fn(async (_o: unknown) => ({ error: null }));
const senhaVazada = vi.fn(async (_s: string) => false);
let usuario: { id: string; app_metadata?: Record<string, unknown> } | null = null;
// A marca de conta sem senha (#389) sai pela chave secreta.
const esquece = vi.fn(async (_id: string) => true);
// O jar de cookies do request: a marca da recuperacao (#234) mora aqui.
const jar = new Map<string, string>();

vi.mock('@/lib/supabase/servidor', () => ({
  usuarioDaSessao: async () => usuario,
  clienteDeAuth: async () => ({ auth: { updateUser, signOut } }),
}));
vi.mock('@/lib/conta/codigo', () => ({ esqueceContaSemSenha: (id: string) => esquece(id) }));
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
const { criaMarcaDeRecuperacao } = await import('@/lib/conta/recuperacao');
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
  vi.stubEnv('CONVITE_COOKIE_SECRET', 'sb_secret_de_teste');
  jar.set('par_recuperacao', criaMarcaDeRecuperacao(usuario.id) ?? '');
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

  it('conta que nasceu pelo codigo (#389): a marca de sem senha sai', async () => {
    if (!usuario) throw new Error('sem usuario');
    usuario.app_metadata = { sem_senha: true };
    await expect(envia()).rejects.toThrow('redirect:/conta');
    expect(esquece).toHaveBeenCalledWith(usuario.id);
  });

  it('conta com senha: nao chama a chave secreta', async () => {
    await expect(envia()).rejects.toThrow('redirect:/conta');
    expect(esquece).not.toHaveBeenCalled();
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
    jar.set('par_recuperacao', criaMarcaDeRecuperacao(usuario.id) ?? '');
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

  // #348: a marca e presa a conta. A que sobrou de outra sessao no mesmo
  // navegador, ou o valor antigo `1`, nao troca a senha desta.
  it('marca de outra conta nao troca nada', async () => {
    jar.set(
      'par_recuperacao',
      criaMarcaDeRecuperacao('22222222-2222-4222-8222-222222222222') ?? ''
    );
    const r = await envia();

    expect(r.erro).toMatch(/não vale mais/i);
    expect(updateUser).not.toHaveBeenCalled();
  });

  it('a marca antiga, sem assinatura, nao troca nada', async () => {
    jar.set('par_recuperacao', '1');
    const r = await envia();

    expect(r.erro).toMatch(/não vale mais/i);
    expect(updateUser).not.toHaveBeenCalled();
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
