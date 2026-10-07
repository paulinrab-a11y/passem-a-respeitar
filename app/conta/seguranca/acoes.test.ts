import { beforeEach, describe, expect, it, vi } from 'vitest';
import { encerrarSessao, reautenticarEEncerrar, trocarSenha } from './acoes';
import { senhaInicial } from './estado';
import { sessaoInicial } from './estado-sessoes';

let n = 0;
let usuario: { id: string; email: string } | null = null;
let lembrar = true;
let cabecalhos = new Headers();

const updateUser = vi.fn(async (_: { password: string }) => ({
  error: null as { message: string } | null,
}));
const signOut = vi.fn(async (_?: { scope: string }) => ({ error: null }));
const clienteDeAuth = vi.fn(async (_lembrar: boolean) => ({
  auth: { updateUser, signOut },
}));

const rpc = vi.fn(async (_f: string, _a?: unknown) => ({
  data: true as unknown,
  error: null as { message: string } | null,
}));

vi.mock('@/lib/supabase/servidor', () => ({
  usuarioDaSessao: async () => usuario,
  clienteServidor: async () => ({ rpc }),
  clienteDeAuth: (l: boolean) => clienteDeAuth(l),
  lembrarDaSessao: async () => lembrar,
}));

vi.mock('next/headers', () => ({
  headers: async () => cabecalhos,
}));

const revalidatePath = vi.fn();
vi.mock('next/cache', () => ({ revalidatePath: (p: string) => revalidatePath(p) }));

/** SHA-256 tem 64 caracteres hex — o formato que a lista entrega. */
const HASH = 'a'.repeat(64);

const vazada = vi.fn(async (_: string) => false);
vi.mock('@/lib/conta/senha-servidor', () => ({ senhaVazada: (s: string) => vazada(s) }));

type Conferencia = 'certa' | 'errada' | 'indisponivel';

/** A conferencia de senha virou helper compartilhado na #40. */
const confere = vi.fn(async (_email: string, _senha: string): Promise<Conferencia> => 'certa');
const recente = vi.fn(async () => true);
const refaz = vi.fn(async (_senha: string): Promise<Conferencia> => 'certa');
vi.mock('@/lib/conta/reautenticacao', () => ({
  JANELA_MINUTOS: 15,
  RECADO_INDISPONIVEL: 'Não deu para conferir a senha agora. Tente de novo em instantes.',
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

const comSenha = (senha: string, identificador = HASH) => form({ identificador, senha });

beforeEach(() => {
  vi.clearAllMocks();
  confere.mockResolvedValue('certa');
  updateUser.mockResolvedValue({ error: null });
  vazada.mockResolvedValue(false);
  rpc.mockResolvedValue({ data: true, error: null });
  recente.mockResolvedValue(true);
  refaz.mockResolvedValue('certa');
  lembrar = true;
  // Usuario e IP novos a cada caso: o rate limit guarda estado no modulo.
  n += 1;
  usuario = { id: `1111-${n}`, email: 'pessoa@exemplo.invalid' };
  cabecalhos = new Headers({ 'x-forwarded-for': `203.0.113.${(n % 200) + 1}` });
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

  // `updateUser` regrava os cookies. Com `true` fixo, trocar a senha num
  // computador emprestado deixava a sessao viva ali por trinta dias (#244).
  it('respeita a escolha de manter conectado, nas duas direcoes', async () => {
    await trocarSenha(senhaInicial, completo());
    expect(clienteDeAuth).toHaveBeenLastCalledWith(true);

    lembrar = false;
    usuario = { id: `1111-${n}-b`, email: 'pessoa@exemplo.invalid' };
    await trocarSenha(senhaInicial, completo());
    expect(clienteDeAuth).toHaveBeenLastCalledWith(false);
  });
});

describe('conferencia da senha atual', () => {
  it('confere antes de trocar', async () => {
    await trocarSenha(senhaInicial, completo());

    expect(confere).toHaveBeenCalledWith(usuario?.email, 'senha-antiga-valida');
  });

  it('recusa quando a senha atual esta errada, apontando o campo', async () => {
    confere.mockResolvedValue('errada');
    const r = await trocarSenha(senhaInicial, completo());

    expect(r.recado?.tom).toBe('erro');
    expect(r.campo).toBe('atual');
    expect(updateUser).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
  });

  // Servico fora do ar nao e senha errada: apontar o campo mandaria a pessoa
  // redigitar uma senha que estava certa.
  it('servico indisponivel pede para tentar depois, sem culpar a senha', async () => {
    confere.mockResolvedValue('indisponivel');
    const r = await trocarSenha(senhaInicial, completo());

    expect(r.recado?.tom).toBe('erro');
    expect(r.recado?.texto).toMatch(/não deu para conferir/i);
    expect(r.recado?.texto).not.toMatch(/incorreta/i);
    expect(r.campo).toBe(null);
    expect(updateUser).not.toHaveBeenCalled();
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
    confere.mockResolvedValue('errada');
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
    confere.mockResolvedValue('errada');

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
    confere.mockResolvedValue('errada');
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
    const r = await reautenticarEEncerrar(sessaoInicial, comSenha('certa'));

    expect(refaz).toHaveBeenCalledWith('certa');
    expect(rpc).toHaveBeenCalledWith('encerra_sessao', { p_identificador: HASH });
    expect(r.recado?.tom).toBe('ok');
  });

  it('recusa senha errada e continua pedindo', async () => {
    refaz.mockResolvedValue('errada');
    const r = await reautenticarEEncerrar(sessaoInicial, comSenha('errada'));

    expect(r.precisaReautenticar).toBe(true);
    expect(r.recado?.tom).toBe('erro');
    expect(r.recado?.texto).toMatch(/incorreta/i);
    expect(rpc).not.toHaveBeenCalled();
  });

  // Supabase no limite ou fora do ar: a pessoa digitou a senha certa e nao
  // pode ouvir que errou. O modal fica aberto para ela tentar em seguida.
  it('servico indisponivel pede para tentar depois, sem culpar a senha', async () => {
    refaz.mockResolvedValue('indisponivel');
    const r = await reautenticarEEncerrar(sessaoInicial, comSenha('certa'));

    expect(r.precisaReautenticar).toBe(true);
    expect(r.recado?.texto).toMatch(/não deu para conferir/i);
    expect(r.recado?.texto).not.toMatch(/incorreta/i);
    expect(rpc).not.toHaveBeenCalled();
  });

  // Identificador com cara errada nao gasta tentativa de ninguem: a senha
  // nem e conferida para uma acao que seria recusada de qualquer jeito.
  it('nao confere a senha com identificador invalido', async () => {
    const r = await reautenticarEEncerrar(sessaoInicial, comSenha('certa', 'nao-e-hash'));

    expect(r.recado?.tom).toBe('erro');
    expect(refaz).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('recusa sem sessao, sem conferir a senha', async () => {
    usuario = null;
    const r = await reautenticarEEncerrar(sessaoInicial, comSenha('certa'));

    expect(r.recado?.tom).toBe('erro');
    expect(refaz).not.toHaveBeenCalled();
  });

  it('a senha nao aparece no que volta para a tela', async () => {
    refaz.mockResolvedValue('errada');
    const r = await reautenticarEEncerrar(sessaoInicial, comSenha('minha-senha-secreta'));

    expect(JSON.stringify(r)).not.toContain('minha-senha-secreta');
  });
});

describe('limite da reautenticacao (#244)', () => {
  // Sem este limite, quem tem a sessao aberta num computador alheio roda a
  // lista de senhas pelo modal, e o limite da troca de senha nao serve de
  // nada — e a mesma senha por outra porta.
  it('a sexta tentativa na hora e recusada antes de conferir a senha', async () => {
    refaz.mockResolvedValue('errada');

    for (let i = 0; i < 5; i++) {
      const r = await reautenticarEEncerrar(sessaoInicial, comSenha('chute'));
      expect(r.recado?.texto).not.toMatch(/Muitas tentativas/);
    }
    expect(refaz).toHaveBeenCalledTimes(5);

    const bloqueado = await reautenticarEEncerrar(sessaoInicial, comSenha('chute'));

    expect(bloqueado.recado?.texto).toMatch(/Muitas tentativas/);
    expect(refaz).toHaveBeenCalledTimes(5);
  });

  // O modal fica aberto mostrando o motivo. Fechar esconderia o "muitas
  // tentativas" de quem so precisa esperar.
  it('bloqueado continua pedindo a senha, com o recado', async () => {
    refaz.mockResolvedValue('errada');
    for (let i = 0; i < 5; i++) await reautenticarEEncerrar(sessaoInicial, comSenha('chute'));

    const bloqueado = await reautenticarEEncerrar(sessaoInicial, comSenha('chute'));

    expect(bloqueado.precisaReautenticar).toBe(true);
    expect(bloqueado.recado?.tom).toBe('erro');
  });

  // Acertar tambem conta: o limite e de tentativas, nao de erros. Quem acerta
  // de primeira nunca chega perto dele.
  it('a tentativa certa tambem gasta a cota', async () => {
    for (let i = 0; i < 5; i++) await reautenticarEEncerrar(sessaoInicial, comSenha('certa'));

    const bloqueado = await reautenticarEEncerrar(sessaoInicial, comSenha('certa'));
    expect(bloqueado.recado?.texto).toMatch(/Muitas tentativas/);
  });

  it('a cota e por conta: outra conta no mesmo IP continua passando', async () => {
    refaz.mockResolvedValue('errada');
    for (let i = 0; i < 5; i++) await reautenticarEEncerrar(sessaoInicial, comSenha('chute'));

    usuario = { id: `1111-${n}-outra`, email: 'outra@exemplo.invalid' };
    const r = await reautenticarEEncerrar(sessaoInicial, comSenha('chute'));

    expect(r.recado?.texto).not.toMatch(/Muitas tentativas/);
  });

  // Uma origem so nao testa senhas em varias contas sequestradas trocando de
  // conta a cada cinco chutes.
  it('a cota por IP segura quem troca de conta', async () => {
    refaz.mockResolvedValue('errada');

    for (let i = 0; i < 20; i++) {
      usuario = { id: `1111-${n}-ip-${i}`, email: 'alguem@exemplo.invalid' };
      const r = await reautenticarEEncerrar(sessaoInicial, comSenha('chute'));
      expect(r.recado?.texto).not.toMatch(/Muitas tentativas/);
    }

    usuario = { id: `1111-${n}-ip-21`, email: 'alguem@exemplo.invalid' };
    const bloqueado = await reautenticarEEncerrar(sessaoInicial, comSenha('chute'));

    expect(bloqueado.recado?.texto).toMatch(/Muitas tentativas/);
    expect(refaz).toHaveBeenCalledTimes(20);
  });
});
