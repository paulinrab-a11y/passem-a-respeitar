import { beforeEach, describe, expect, it, vi } from 'vitest';
import { encerrarSessao, trocarSenha } from './acoes';
import { senhaInicial } from './estado';
import { sessaoInicial } from './estado-sessoes';

let n = 0;
let usuario: { id: string; email: string } | null = null;

/** Client avulso: so confere a senha atual, nunca escreve cookie. */
const signInAvulso = vi.fn(async (_: { email: string; password: string }) => ({
  error: null as { message: string } | null,
}));
const opcoesDoAvulso = vi.fn();

vi.mock('@supabase/supabase-js', () => ({
  createClient: (_url: string, _chave: string, opcoes: unknown) => {
    opcoesDoAvulso(opcoes);
    return { auth: { signInWithPassword: signInAvulso } };
  },
}));

const updateUser = vi.fn(async (_: { password: string }) => ({
  error: null as { message: string } | null,
}));
const signOut = vi.fn(async (_?: { scope: string }) => ({ error: null }));
const signInDaSessao = vi.fn();

const rpc = vi.fn(async (_f: string, _a?: unknown) => ({
  data: true as unknown,
  error: null as { message: string } | null,
}));

vi.mock('@/lib/supabase/servidor', () => ({
  usuarioDaSessao: async () => usuario,
  clienteServidor: async () => ({ rpc }),
  clienteDeAuth: async () => ({
    auth: { updateUser, signOut, signInWithPassword: signInDaSessao },
  }),
}));

const revalidatePath = vi.fn();
vi.mock('next/cache', () => ({ revalidatePath: (p: string) => revalidatePath(p) }));

/** SHA-256 tem 64 caracteres hex — o formato que a lista entrega. */
const HASH = 'a'.repeat(64);

const vazada = vi.fn(async (_: string) => false);
vi.mock('@/lib/conta/senha-servidor', () => ({ senhaVazada: (s: string) => vazada(s) }));

const NOVA = 'zumbido-de-jabuticaba-42';

function form(campos: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.append(k, v);
  return f;
}

const completo = (extra: Record<string, string> = {}) =>
  form({ atual: 'senha-antiga-valida', nova: NOVA, confirmacao: NOVA, ...extra });

beforeEach(() => {
  vi.clearAllMocks();
  signInAvulso.mockResolvedValue({ error: null });
  updateUser.mockResolvedValue({ error: null });
  vazada.mockResolvedValue(false);
  rpc.mockResolvedValue({ data: true, error: null });
  // Usuario novo a cada caso: o rate limit guarda estado no modulo.
  usuario = { id: `1111-${n++}`, email: 'pessoa@exemplo.invalid' };
});

describe('caminho feliz', () => {
  it('troca a senha e avisa', async () => {
    const r = await trocarSenha(senhaInicial, completo());

    expect(updateUser).toHaveBeenCalledWith({ password: NOVA });
    expect(r.recado?.tom).toBe('ok');
  });

  // O ponto da troca de senha: quem tinha acesso perde. `others` derruba as
  // outras e mantem esta — jogar quem trocou para o login logo depois de
  // fazer a coisa certa seria punir o comportamento correto.
  it('derruba as outras sessoes e mantem a atual', async () => {
    await trocarSenha(senhaInicial, completo());
    expect(signOut).toHaveBeenCalledWith({ scope: 'others' });
  });

  it('avisa que as outras sessoes cairam', async () => {
    const r = await trocarSenha(senhaInicial, completo());
    expect(r.recado?.texto).toMatch(/outros aparelhos/i);
  });
});

describe('conferencia da senha atual', () => {
  it('confere antes de trocar', async () => {
    await trocarSenha(senhaInicial, completo());

    expect(signInAvulso).toHaveBeenCalledWith({
      email: usuario?.email,
      password: 'senha-antiga-valida',
    });
  });

  // Se a conferencia usasse o client da sessao, `signInWithPassword`
  // rotacionaria o token e reescreveria os cookies: a pessoa acabaria com
  // uma sessao nova so por ter digitado a senha certa num formulario.
  it('usa um client descartavel, que nao persiste sessao', async () => {
    await trocarSenha(senhaInicial, completo());

    expect(opcoesDoAvulso).toHaveBeenCalledWith(
      expect.objectContaining({
        auth: expect.objectContaining({ persistSession: false, autoRefreshToken: false }),
      })
    );
    expect(signInDaSessao).not.toHaveBeenCalled();
  });

  it('recusa quando a senha atual esta errada', async () => {
    signInAvulso.mockResolvedValue({ error: { message: 'Invalid login credentials' } });
    const r = await trocarSenha(senhaInicial, completo());

    expect(r.recado?.tom).toBe('erro');
    expect(updateUser).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
  });
});

describe('politica de senha', () => {
  it('recusa senha vazada, sem trocar', async () => {
    vazada.mockResolvedValue(true);
    const r = await trocarSenha(senhaInicial, completo());

    expect(r.recado?.texto).toMatch(/vazamentos/i);
    expect(updateUser).not.toHaveBeenCalled();
  });

  it('checa o vazamento da NOVA senha, nunca da atual', async () => {
    await trocarSenha(senhaInicial, completo());

    expect(vazada).toHaveBeenCalledWith(NOVA);
    expect(vazada).not.toHaveBeenCalledWith('senha-antiga-valida');
  });

  // Ordem importa: conferir a senha atual antes gasta menos e nao manda a
  // senha de quem nem provou quem e para um servico de fora.
  it('so consulta o vazamento depois de a senha atual conferir', async () => {
    signInAvulso.mockResolvedValue({ error: { message: 'nao' } });
    await trocarSenha(senhaInicial, completo());

    expect(vazada).not.toHaveBeenCalled();
  });

  it.each([
    ['curta', { nova: 'abc123', confirmacao: 'abc123' }],
    ['vazia', { nova: '', confirmacao: '' }],
  ])('recusa senha %s', async (_nome, campos) => {
    const r = await trocarSenha(senhaInicial, completo(campos));

    expect(r.recado?.tom).toBe('erro');
    expect(updateUser).not.toHaveBeenCalled();
  });

  it('recusa quando a confirmacao nao bate', async () => {
    const r = await trocarSenha(senhaInicial, completo({ confirmacao: 'outra-coisa-qualquer' }));

    expect(r.recado?.texto).toMatch(/confirmação/i);
    expect(updateUser).not.toHaveBeenCalled();
  });

  // Trocar a senha pela mesma senha nao e troca: e a pessoa achando que fez
  // algo enquanto a senha comprometida continua valendo.
  it('recusa a nova senha igual a atual', async () => {
    const r = await trocarSenha(senhaInicial, form({ atual: NOVA, nova: NOVA, confirmacao: NOVA }));

    expect(r.recado?.texto).toMatch(/igual/i);
    expect(updateUser).not.toHaveBeenCalled();
  });
});

describe('sessao e limites', () => {
  it('recusa sem sessao', async () => {
    usuario = null;
    const r = await trocarSenha(senhaInicial, completo());

    expect(r.recado?.tom).toBe('erro');
    expect(signInAvulso).not.toHaveBeenCalled();
  });

  it('bloqueia depois de cinco tentativas', async () => {
    signInAvulso.mockResolvedValue({ error: { message: 'nao' } });

    for (let i = 0; i < 5; i++) {
      const r = await trocarSenha(senhaInicial, completo());
      expect(r.recado?.texto).not.toMatch(/Muitas tentativas/);
    }

    const bloqueado = await trocarSenha(senhaInicial, completo());
    expect(bloqueado.recado?.texto).toMatch(/Muitas tentativas/);
  });

  it('avisa sem repassar a mensagem do Supabase', async () => {
    updateUser.mockResolvedValue({ error: { message: 'weak_password: too short' } });
    const r = await trocarSenha(senhaInicial, completo());

    expect(r.recado?.tom).toBe('erro');
    expect(r.recado?.texto).not.toMatch(/weak_password/);
  });

  it('nenhuma senha aparece no que volta para a tela', async () => {
    signInAvulso.mockResolvedValue({ error: { message: 'nao' } });
    const r = await trocarSenha(senhaInicial, completo());

    const texto = JSON.stringify(r);
    expect(texto).not.toContain(NOVA);
    expect(texto).not.toContain('senha-antiga-valida');
  });
});

describe('encerrarSessao', () => {
  it('chama a funcao do banco com o identificador', async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    const r = await encerrarSessao(sessaoInicial, form({ identificador: HASH }));

    expect(rpc).toHaveBeenCalledWith('encerra_sessao', { p_identificador: HASH });
    expect(r.recado?.tom).toBe('ok');
    expect(r.encerrado).toBe(HASH);
  });

  // Identificador com cara errada nem chega ao banco.
  it.each([
    ['vazio', ''],
    ['curto', 'abc'],
    ['com letra fora do hex', `${'z'.repeat(64)}`],
    ['uuid, que e o id interno', '52bfa91f-ae27-41bc-8cf4-d9e123e9dcc7'],
  ])('recusa identificador %s sem consultar o banco', async (_nome, id) => {
    const r = await encerrarSessao(sessaoInicial, form({ identificador: id }));

    expect(r.recado?.tom).toBe('erro');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('recusa sem sessao', async () => {
    usuario = null;
    const r = await encerrarSessao(sessaoInicial, form({ identificador: HASH }));

    expect(r.recado?.tom).toBe('erro');
    expect(rpc).not.toHaveBeenCalled();
  });

  // O banco devolve false para sessao de outro, para a atual e para uma que ja
  // caiu. As tres respondem igual: dizer qual delas e contaria algo a quem
  // estava tentando adivinhar.
  it('responde igual quando o banco recusa', async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    const r = await encerrarSessao(sessaoInicial, form({ identificador: HASH }));

    expect(r.recado?.tom).toBe('erro');
    expect(r.encerrado).toBe(null);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('avisa sem repassar a mensagem do banco', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: 'permission denied for table sessions' },
    });
    const r = await encerrarSessao(sessaoInicial, form({ identificador: HASH }));

    expect(r.recado?.texto).not.toMatch(/permission denied/);
  });

  it('revalida a pagina depois de encerrar', async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    await encerrarSessao(sessaoInicial, form({ identificador: HASH }));

    expect(revalidatePath).toHaveBeenCalledWith('/conta/seguranca');
  });
});
