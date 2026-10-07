import { beforeEach, describe, expect, it, vi } from 'vitest';
import { exclusaoInicial } from './estado-exclusao';
import { excluirConta } from './excluir';

/** A conferencia de senha virou helper compartilhado na #40. */

let n = 0;
let usuario: { id: string; email: string } | null = null;

type Conferencia = 'certa' | 'errada' | 'indisponivel';
const confere = vi.fn(async (_email: string, _senha: string): Promise<Conferencia> => 'certa');
vi.mock('@/lib/conta/reautenticacao', () => ({
  RECADO_INDISPONIVEL: 'Não deu para conferir a senha agora. Tente de novo em instantes.',
  senhaConfere: (email: string, senha: string) => confere(email, senha),
}));

let fotoCaminho: string | null = null;
const remove = vi.fn(async (_: string[]) => ({ error: null }));

vi.mock('@/lib/supabase/servidor', () => ({
  usuarioDaSessao: async () => usuario,
  clienteServidor: async () => ({
    storage: { from: () => ({ remove }) },
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: { foto_caminho: fotoCaminho } }) }),
      }),
    }),
  }),
}));

const updateOrders = vi.fn(() => ({ eq: eqOrders }));
const eqOrders = vi.fn(async () => ({ error: null }));
const deleteUser = vi.fn(async (_id: string) => ({ error: null as { message: string } | null }));

vi.mock('@/lib/supabase/admin', () => ({
  clienteAdmin: () => ({
    from: () => ({ update: updateOrders }),
    auth: { admin: { deleteUser } },
  }),
}));

const jarDelete = vi.fn();
vi.mock('next/headers', () => ({
  cookies: async () => ({
    getAll: () => [{ name: 'sb-abc-auth-token' }, { name: 'par_lembrar' }, { name: 'outro' }],
    delete: jarDelete,
  }),
}));

class Redirecionou extends Error {
  constructor(readonly destino: string) {
    super(`redirect:${destino}`);
  }
}
vi.mock('next/navigation', () => ({
  redirect: (destino: string) => {
    throw new Redirecionou(destino);
  },
}));

const EMAIL = 'pessoa@exemplo.invalid';
const SENHA = 'senha-de-teste-descartavel';

function form(campos: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.append(k, v);
  return f;
}

const certo = (extra: Record<string, string> = {}) =>
  form({ email: EMAIL, senha: SENHA, ...extra });

beforeEach(() => {
  vi.clearAllMocks();
  confere.mockResolvedValue('certa');
  deleteUser.mockResolvedValue({ error: null });
  fotoCaminho = null;
  // Usuario novo a cada caso: o rate limit guarda estado no modulo.
  usuario = { id: `1111-${n++}`, email: EMAIL };
});

describe('confirmacao', () => {
  // O atrito e o ponto da tela. Sem ele, "excluir conta" vira um botao a um
  // clique de distancia de uma acao que nao da para desfazer.
  it('recusa quando o e-mail digitado nao e o da conta', async () => {
    const r = await excluirConta(exclusaoInicial, certo({ email: 'outro@exemplo.invalid' }));

    expect(r.recado?.tom).toBe('erro');
    expect(deleteUser).not.toHaveBeenCalled();
    expect(confere).not.toHaveBeenCalled();
  });

  it('aceita o e-mail em qualquer caixa', async () => {
    await expect(
      excluirConta(exclusaoInicial, certo({ email: '  PESSOA@EXEMPLO.INVALID ' }))
    ).rejects.toThrow('redirect:');
  });

  // A senha e a reautenticacao: sem ela, quem sentou no computador alheio
  // apaga a conta de outra pessoa.
  it('recusa quando a senha esta errada', async () => {
    confere.mockResolvedValue('errada');
    const r = await excluirConta(exclusaoInicial, certo());

    expect(r.recado?.tom).toBe('erro');
    expect(deleteUser).not.toHaveBeenCalled();
  });

  // Numa acao irreversivel, "senha incorreta" com a senha certa e o pior
  // recado: a pessoa redigita, redigita, e a conta continua la (#244).
  it('conferencia indisponivel pede para tentar depois, sem apagar nada', async () => {
    confere.mockResolvedValue('indisponivel');
    const r = await excluirConta(exclusaoInicial, certo());

    expect(r.recado?.texto).toMatch(/não deu para conferir/i);
    expect(r.recado?.texto).not.toMatch(/incorreta/i);
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it('recusa sem sessao', async () => {
    usuario = null;
    const r = await excluirConta(exclusaoInicial, certo());

    expect(r.recado?.tom).toBe('erro');
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it('bloqueia depois de tres tentativas', async () => {
    confere.mockResolvedValue('errada');

    for (let i = 0; i < 3; i++) await excluirConta(exclusaoInicial, certo());
    const r = await excluirConta(exclusaoInicial, certo());

    expect(r.recado?.texto).toMatch(/Muitas tentativas/);
  });
});

describe('o que some e o que fica', () => {
  it('apaga o usuario da sessao, e nenhum outro', async () => {
    await expect(excluirConta(exclusaoInicial, certo())).rejects.toThrow('redirect:');
    expect(deleteUser).toHaveBeenCalledWith(usuario?.id);
  });

  it('apaga a foto do bucket', async () => {
    fotoCaminho = `${usuario?.id}/abc.webp`;
    await expect(excluirConta(exclusaoInicial, certo())).rejects.toThrow();

    expect(remove).toHaveBeenCalledWith([fotoCaminho]);
  });

  // Depois de apagar a conta nao ha sessao, e a policy do storage nao
  // reconheceria o dono: o arquivo ficaria orfao no bucket para sempre.
  it('apaga a foto ANTES do usuario', async () => {
    fotoCaminho = `${usuario?.id}/abc.webp`;
    await expect(excluirConta(exclusaoInicial, certo())).rejects.toThrow();

    expect(remove.mock.invocationCallOrder[0]).toBeLessThan(deleteUser.mock.invocationCallOrder[0]);
  });

  it('nao tenta apagar foto que nao existe', async () => {
    await expect(excluirConta(exclusaoInicial, certo())).rejects.toThrow();
    expect(remove).not.toHaveBeenCalled();
  });

  it('carimba a anonimizacao dos pedidos', async () => {
    await expect(excluirConta(exclusaoInicial, certo())).rejects.toThrow();

    expect(updateOrders).toHaveBeenCalledWith({ anonimizado_em: expect.any(String) });
    expect(eqOrders).toHaveBeenCalledWith('user_id', usuario?.id);
  });

  // Depois do delete, o `on delete set null` ja cortou o vinculo e nao haveria
  // mais como achar quais pedidos eram desta pessoa.
  it('carimba os pedidos ANTES de apagar o usuario', async () => {
    await expect(excluirConta(exclusaoInicial, certo())).rejects.toThrow();

    expect(eqOrders.mock.invocationCallOrder[0]).toBeLessThan(
      deleteUser.mock.invocationCallOrder[0]
    );
  });

  it('limpa os cookies de sessao e o par_lembrar', async () => {
    await expect(excluirConta(exclusaoInicial, certo())).rejects.toThrow();

    expect(jarDelete).toHaveBeenCalledWith('sb-abc-auth-token');
    expect(jarDelete).toHaveBeenCalledWith('par_lembrar');
    // Cookie que nao e nosso fica onde esta.
    expect(jarDelete).not.toHaveBeenCalledWith('outro');
  });

  it('manda para a home avisando', async () => {
    await expect(excluirConta(exclusaoInicial, certo())).rejects.toThrow(
      'redirect:/?conta=excluida'
    );
  });
});

describe('quando o Supabase recusa', () => {
  it('avisa sem repassar a mensagem dele', async () => {
    deleteUser.mockResolvedValue({ error: { message: 'user_not_found or db error' } });
    const r = await excluirConta(exclusaoInicial, certo());

    expect(r.recado?.tom).toBe('erro');
    expect(r.recado?.texto).not.toMatch(/user_not_found/);
  });

  it('nao limpa cookie se a exclusao falhou', async () => {
    deleteUser.mockResolvedValue({ error: { message: 'falhou' } });
    await excluirConta(exclusaoInicial, certo());

    expect(jarDelete).not.toHaveBeenCalled();
  });
});

describe('a senha nunca escapa', () => {
  it('nao aparece no que volta para a tela', async () => {
    confere.mockResolvedValue('errada');
    const r = await excluirConta(exclusaoInicial, certo());

    expect(JSON.stringify(r)).not.toContain(SENHA);
  });
});
