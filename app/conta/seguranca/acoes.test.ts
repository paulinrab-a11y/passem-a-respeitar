import { beforeEach, describe, expect, it, vi } from 'vitest';
import { trocarSenha } from './acoes';
import { senhaInicial } from './estado';

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

vi.mock('@/lib/supabase/servidor', () => ({
  usuarioDaSessao: async () => usuario,
  clienteDeAuth: async () => ({
    auth: { updateUser, signOut, signInWithPassword: signInDaSessao },
  }),
}));

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
