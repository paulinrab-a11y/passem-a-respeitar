import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * "Criar senha" em Seguranca (#389). O que se prova:
 *
 * - so a conta marcada como sem senha pelo servidor passa; a outra recebe
 *   "use Trocar senha", e nada sai para o Supabase;
 * - o codigo vai para o e-mail da sessao, nunca para um do formulario;
 * - a senha passa pelas regras do cadastro, e a vazada nao gasta o codigo;
 * - sem o codigo certo, nada e gravado;
 * - gravada, a sessao nasce de novo com a senha e as outras caem;
 * - os limites por IP, por caixa e por conta.
 */

type Usuario = { id: string; email: string; app_metadata: Record<string, unknown> };

let n = 0;
let usuario: Usuario | null = null;
let lembrar = false;
let cabecalhos = new Headers();
let ordem: string[] = [];

const signInWithPassword = vi.fn(async (_: unknown) => {
  ordem.push('signInWithPassword');
  return { error: null as { message: string } | null };
});
const signOut = vi.fn(async (o: { scope: string }) => {
  ordem.push(`signOut:${o.scope}`);
  return { error: null };
});
const clienteDeAuth = vi.fn(async (_lembrar: boolean) => ({
  auth: { signInWithPassword, signOut },
}));

vi.mock('@/lib/supabase/servidor', () => ({
  usuarioDaSessao: async () => usuario,
  clienteDeAuth: (l: boolean) => clienteDeAuth(l),
  lembrarDaSessao: async () => lembrar,
  cabecalhosDeOrigem: async () => ({}),
}));
vi.mock('next/headers', () => ({ headers: async () => cabecalhos }));
const revalidatePath = vi.fn();
vi.mock('next/cache', () => ({ revalidatePath: (p: string) => revalidatePath(p) }));

const vazada = vi.fn(async (_: string) => false);
vi.mock('@/lib/conta/senha-servidor', () => ({ senhaVazada: (s: string) => vazada(s) }));

// Os limites ficam os de verdade (lib/conta/codigo.ts); o Supabase, nao.
const manda = vi.fn(async (_email: string) => true);
const confere = vi.fn(async (_email: string, _codigo: string) => {
  ordem.push('confere');
  return true;
});
const grava = vi.fn(async (_id: string, _senha: string) => {
  ordem.push('grava');
  return { error: null as Error | null };
});
vi.mock('@/lib/conta/codigo', async (original) => ({
  ...(await original<typeof import('@/lib/conta/codigo')>()),
  mandaCodigoDaConta: (email: string) => manda(email),
  codigoDaContaConfere: (email: string, codigo: string) => confere(email, codigo),
  gravaSenhaCriada: (id: string, senha: string) => grava(id, senha),
}));

const { criarSenha, pedirCodigoDaSenha } = await import('./criar-senha');
const { criarSenhaInicial, envioDaSenhaInicial } = await import('./estado-criar-senha');

const NOVA = 'zumbido-de-jabuticaba-42';

function form(campos: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.append(k, v);
  return f;
}

const completo = (extra: Record<string, string> = {}) =>
  form({ codigo: '12345678', nova: NOVA, confirmacao: NOVA, ...extra });

const cria = (f = completo()) => criarSenha(criarSenhaInicial, f);
const pede = (f = new FormData()) => pedirCodigoDaSenha(envioDaSenhaInicial, f);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('CONTA_PISO_MS', '0');
  ordem = [];
  manda.mockResolvedValue(true);
  vazada.mockResolvedValue(false);
  signInWithPassword.mockImplementation(async () => {
    ordem.push('signInWithPassword');
    return { error: null };
  });
  lembrar = false;
  // Conta, caixa e IP novos a cada caso: os limites guardam estado no modulo.
  n += 1;
  usuario = {
    id: `2222-${n}`,
    email: `codigo${n}@exemplo.invalid`,
    app_metadata: { provider: 'email', sem_senha: true },
  };
  cabecalhos = new Headers({ 'x-forwarded-for': `198.51.100.${(n % 200) + 1}` });
});

describe('pedirCodigoDaSenha', () => {
  it('manda o codigo para o e-mail da sessao, e nao para o do formulario', async () => {
    const r = await pede(form({ email: 'outra@exemplo.invalid' }));

    expect(manda).toHaveBeenCalledTimes(1);
    expect(manda).toHaveBeenCalledWith(usuario?.email);
    expect(r.recado?.tom).toBe('ok');
    expect(r.enviadoEm).toEqual(expect.any(Number));
  });

  it('sem sessao, nada sai', async () => {
    usuario = null;
    const r = await pede();
    expect(r.recado).toEqual({ tom: 'erro', texto: 'Sua sessão expirou. Entre de novo.' });
    expect(manda).not.toHaveBeenCalled();
  });

  it.each([
    ['sem a marca', {}],
    ['marca que nao e true', { sem_senha: 'true' }],
  ])('conta com senha (%s): manda usar a troca, e nada sai', async (_, metadata) => {
    if (!usuario) throw new Error('sem usuario');
    usuario.app_metadata = metadata;
    const r = await pede();
    expect(r.recado?.texto).toMatch(/já tem senha/);
    expect(manda).not.toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith('/conta/seguranca');
  });

  it('o Supabase recusando: diz que nao enviou, sem recomecar a espera', async () => {
    manda.mockResolvedValueOnce(false);
    const r = await pede();
    expect(r.recado?.tom).toBe('erro');
    expect(r.enviadoEm).toBeNull();
  });

  it('tres por caixa por hora, a cota do codigo do cadastro', async () => {
    for (let i = 0; i < 3; i++) expect((await pede()).recado?.tom).toBe('ok');
    const r = await pede();
    expect(r.recado?.texto).toMatch(/Muitos pedidos/);
    expect(manda).toHaveBeenCalledTimes(3);
  });

  it('cinco por IP por hora, de contas diferentes', async () => {
    for (let i = 0; i < 5; i++) {
      if (!usuario) throw new Error('sem usuario');
      usuario = { ...usuario, id: `${usuario.id}-${i}`, email: `ip${n}-${i}@exemplo.invalid` };
      expect((await pede()).recado?.tom).toBe('ok');
    }
    if (!usuario) throw new Error('sem usuario');
    usuario = { ...usuario, email: `ip${n}-ultima@exemplo.invalid` };
    expect((await pede()).recado?.texto).toMatch(/Muitos pedidos/);
  });
});

describe('criarSenha', () => {
  it('confere o codigo, grava a senha, entra de novo com ela e derruba as outras', async () => {
    lembrar = true;
    const r = await cria();

    expect(r).toEqual({
      recado: {
        tom: 'ok',
        texto: 'Senha criada. As sessões abertas em outros aparelhos foram encerradas.',
      },
      campo: null,
      tentativa: 1,
      criada: true,
    });
    expect(ordem).toEqual(['confere', 'grava', 'signInWithPassword', 'signOut:others']);
    expect(confere).toHaveBeenCalledWith(usuario?.email, '12345678');
    expect(grava).toHaveBeenCalledWith(usuario?.id, NOVA);
    expect(signInWithPassword).toHaveBeenCalledWith({ email: usuario?.email, password: NOVA });
    // A sessao nova herda o "manter conectado" de quem entrou (#244).
    expect(clienteDeAuth).toHaveBeenCalledWith(true);
    expect(revalidatePath).toHaveBeenCalledWith('/conta/seguranca');
  });

  it('o codigo colado com texto em volta vale', async () => {
    await cria(completo({ codigo: 'Seu código: 1234 5678' }));
    expect(confere).toHaveBeenCalledWith(usuario?.email, '12345678');
  });

  it('isca preenchida: nada acontece', async () => {
    const r = await cria(completo({ website: 'http://robo.invalid' }));
    expect(r.recado?.tom).toBe('erro');
    expect(confere).not.toHaveBeenCalled();
    expect(grava).not.toHaveBeenCalled();
  });

  it('sem sessao, nada acontece', async () => {
    usuario = null;
    const r = await cria();
    expect(r.recado?.texto).toBe('Sua sessão expirou. Entre de novo.');
    expect(grava).not.toHaveBeenCalled();
  });

  it('conta com senha nao cria pelo codigo: a troca pede a atual', async () => {
    if (!usuario) throw new Error('sem usuario');
    usuario.app_metadata = { provider: 'email' };
    const r = await cria();
    expect(r.recado?.texto).toMatch(/já tem senha/);
    expect(confere).not.toHaveBeenCalled();
    expect(grava).not.toHaveBeenCalled();
  });

  it.each([
    ['codigo curto', { codigo: '1234' }, 'codigo', /8 dígitos/],
    ['senha curta', { nova: 'curta', confirmacao: 'curta' }, 'nova', /8 caracteres/],
    ['confirmacao diferente', { confirmacao: 'outra-coisa-qualquer' }, 'confirmacao', /não bate/],
  ])('%s: aponta o campo e nao gasta o codigo', async (_, campos, campo, texto) => {
    const r = await cria(completo(campos));
    expect(r.campo).toBe(campo);
    expect(r.recado?.texto).toMatch(texto);
    expect(confere).not.toHaveBeenCalled();
  });

  it('senha vazada: recusa antes do codigo, que continua valendo', async () => {
    vazada.mockResolvedValueOnce(true);
    const r = await cria();
    expect(r.campo).toBe('nova');
    expect(r.recado?.texto).toMatch(/vazamentos/);
    expect(confere).not.toHaveBeenCalled();
    expect(grava).not.toHaveBeenCalled();
  });

  it('codigo errado: nada e gravado e o campo do codigo e apontado', async () => {
    confere.mockResolvedValueOnce(false);
    const r = await cria();
    expect(r.campo).toBe('codigo');
    expect(r.recado?.texto).toMatch(/inválido ou vencido/);
    expect(grava).not.toHaveBeenCalled();
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it('gravacao que falha: nao entra de novo nem diz que criou', async () => {
    grava.mockResolvedValueOnce({ error: new Error('fetch failed') });
    const r = await cria();
    expect(r.recado?.tom).toBe('erro');
    expect(r.criada).toBeUndefined();
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it('gravada, mas sem sessao nova: diz que criou e manda entrar de novo', async () => {
    signInWithPassword.mockResolvedValueOnce({ error: { message: 'fetch failed' } });
    const r = await cria();
    expect(r.criada).toBe(true);
    expect(r.recado?.texto).toMatch(/Entre de novo/);
    expect(signOut).not.toHaveBeenCalled();
  });

  it('cinco por hora por conta, somando com a troca de senha', async () => {
    confere.mockResolvedValue(false);
    for (let i = 0; i < 5; i++) await cria();
    const r = await cria();
    expect(r.recado?.texto).toMatch(/Muitas tentativas/);
    expect(confere).toHaveBeenCalledTimes(5);
    confere.mockResolvedValue(true);
  });
});
