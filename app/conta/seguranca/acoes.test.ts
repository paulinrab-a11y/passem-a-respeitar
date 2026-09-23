import { beforeEach, describe, expect, it, vi } from 'vitest';
import { encerrarSessao, reautenticarEEncerrar, trocarSenha } from './acoes';
import { senhaInicial } from './estado';
import { sessaoInicial } from './estado-sessoes';

let n = 0;
let usuario: { id: string; email: string } | null = null;

const updateUser = vi.fn(async (_: { password: string }) => ({
  error: null as { message: string } | null,
}));
const signOut = vi.fn(async (_?: { scope: string }) => ({ error: null }));

const rpc = vi.fn(async (_f: string, _a?: unknown) => ({
  data: true as unknown,
  error: null as { message: string } | null,
}));

vi.mock('@/lib/supabase/servidor', () => ({
  usuarioDaSessao: async () => usuario,
  clienteServidor: async () => ({ rpc }),
  clienteDeAuth: async () => ({
    auth: { updateUser, signOut },
  }),
}));

const revalidatePath = vi.fn();
vi.mock('next/cache', () => ({ revalidatePath: (p: string) => revalidatePath(p) }));

/** SHA-256 tem 64 caracteres hex — o formato que a lista entrega. */
const HASH = 'a'.repeat(64);

const vazada = vi.fn(async (_: string) => false);
vi.mock('@/lib/conta/senha-servidor', () => ({ senhaVazada: (s: string) => vazada(s) }));

/** A conferencia de senha virou helper compartilhado na #40. */
const confere = vi.fn(async (_email: string, _senha: string) => true);
const recente = vi.fn(async () => true);
const refaz = vi.fn(async (_senha: string) => true);
vi.mock('@/lib/conta/reautenticacao', () => ({
  JANELA_MINUTOS: 15,
  autenticadoRecentemente: () => recente(),
  reautenticar: (senha: string) => refaz(senha),
  senhaConfere: (email: string, senha: string) => confere(email, senha),
}));

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
  confere.mockResolvedValue(true);
  updateUser.mockResolvedValue({ error: null });
  vazada.mockResolvedValue(false);
  rpc.mockResolvedValue({ data: true, error: null });
  recente.mockResolvedValue(true);
  refaz.mockResolvedValue(true);
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

    expect(confere).toHaveBeenCalledWith(usuario?.email, 'senha-antiga-valida');
  });

  it('recusa quando a senha atual esta errada', async () => {
    confere.mockResolvedValue(false);
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
    confere.mockResolvedValue(false);
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
    expect(confere).not.toHaveBeenCalled();
  });

  it('bloqueia depois de cinco tentativas', async () => {
    confere.mockResolvedValue(false);

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
    confere.mockResolvedValue(false);
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

describe('janela de autenticacao recente (#40)', () => {
  // Derrubar a sessao de outro aparelho e o que quem sequestrou uma sessao
  // aberta usaria para expulsar o dono da propria conta.
  it('pede a senha quando a janela venceu, sem encerrar nada', async () => {
    recente.mockResolvedValue(false);
    const r = await encerrarSessao(sessaoInicial, form({ identificador: HASH }));

    expect(r.precisaReautenticar).toBe(true);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('encerra direto quando a janela esta aberta', async () => {
    const r = await encerrarSessao(sessaoInicial, form({ identificador: HASH }));

    expect(r.precisaReautenticar).toBeUndefined();
    expect(rpc).toHaveBeenCalled();
  });

  // A verificacao acontece depois da sessao e antes do banco: nao adianta
  // gastar ida ao banco de quem vai ser barrado.
  it('a janela e conferida no servidor, nao na tela', async () => {
    recente.mockResolvedValue(false);
    await encerrarSessao(sessaoInicial, form({ identificador: HASH }));

    expect(recente).toHaveBeenCalled();
  });
});

describe('reautenticarEEncerrar', () => {
  // O criterio da Issue: depois de reautenticar, a acao original continua de
  // onde parou. O identificador vem no mesmo formulario, entao nada se perde.
  it('refaz a acao com o mesmo identificador', async () => {
    const r = await reautenticarEEncerrar(
      sessaoInicial,
      form({ identificador: HASH, senha: 'certa' })
    );

    expect(refaz).toHaveBeenCalledWith('certa');
    expect(rpc).toHaveBeenCalledWith('encerra_sessao', { p_identificador: HASH });
    expect(r.recado?.tom).toBe('ok');
  });

  it('recusa senha errada e continua pedindo', async () => {
    refaz.mockResolvedValue(false);
    const r = await reautenticarEEncerrar(
      sessaoInicial,
      form({ identificador: HASH, senha: 'errada' })
    );

    expect(r.precisaReautenticar).toBe(true);
    expect(r.recado?.tom).toBe('erro');
    expect(rpc).not.toHaveBeenCalled();
  });

  // Reautenticar cria sessao nova, entao a janela reabre sozinha — mas a acao
  // continua passando pelas mesmas checagens de sempre.
  it('nao pula a validacao do identificador', async () => {
    const r = await reautenticarEEncerrar(
      sessaoInicial,
      form({ identificador: 'nao-e-hash', senha: 'certa' })
    );

    expect(r.recado?.tom).toBe('erro');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('a senha nao aparece no que volta para a tela', async () => {
    refaz.mockResolvedValue(false);
    const r = await reautenticarEEncerrar(
      sessaoInicial,
      form({ identificador: HASH, senha: 'minha-senha-secreta' })
    );

    expect(JSON.stringify(r)).not.toContain('minha-senha-secreta');
  });
});
