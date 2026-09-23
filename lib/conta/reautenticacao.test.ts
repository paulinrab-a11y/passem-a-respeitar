import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  autenticadoRecentemente,
  JANELA_MINUTOS,
  reautenticar,
  senhaConfere,
} from './reautenticacao';

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

let usuario: { id: string; email: string } | null = null;
const rpc = vi.fn(async (_f: string, _a?: unknown) => ({
  data: true as unknown,
  error: null as { message: string } | null,
}));
const signInDaSessao = vi.fn(async (_: { email: string; password: string }) => ({
  error: null as { message: string } | null,
}));

vi.mock('@/lib/supabase/servidor', () => ({
  usuarioDaSessao: async () => usuario,
  clienteServidor: async () => ({ rpc }),
  clienteDeAuth: async () => ({ auth: { signInWithPassword: signInDaSessao } }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  usuario = { id: 'u1', email: 'pessoa@exemplo.invalid' };
  rpc.mockResolvedValue({ data: true, error: null });
  signInAvulso.mockResolvedValue({ error: null });
  signInDaSessao.mockResolvedValue({ error: null });
});

describe('autenticadoRecentemente', () => {
  it('pergunta ao banco, com a janela em minutos', async () => {
    await autenticadoRecentemente();
    expect(rpc).toHaveBeenCalledWith('autenticado_recentemente', { p_minutos: JANELA_MINUTOS });
  });

  it('aceita uma janela diferente', async () => {
    await autenticadoRecentemente(5);
    expect(rpc).toHaveBeenCalledWith('autenticado_recentemente', { p_minutos: 5 });
  });

  it('devolve o que o banco disser', async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    expect(await autenticadoRecentemente()).toBe(true);

    rpc.mockResolvedValue({ data: false, error: null });
    expect(await autenticadoRecentemente()).toBe(false);
  });

  // Falha fechada: se nao deu para saber, a acao sensivel nao passa. O custo e
  // a pessoa digitar a senha de novo; o custo do contrario e outro.
  it('falha fechada quando o banco erra', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'caiu' } });
    expect(await autenticadoRecentemente()).toBe(false);
  });

  it('falha fechada com resposta estranha', async () => {
    rpc.mockResolvedValue({ data: 'talvez' as unknown, error: null });
    expect(await autenticadoRecentemente()).toBe(false);
  });
});

describe('senhaConfere', () => {
  // Client descartavel: usar o da sessao rotacionaria o token e reescreveria
  // os cookies, e a pessoa sairia com uma sessao nova so por ter digitado a
  // senha certa num formulario de conferencia.
  it('usa um client que nao persiste sessao', async () => {
    await senhaConfere('pessoa@exemplo.invalid', 'certa');

    expect(opcoesDoAvulso).toHaveBeenCalledWith(
      expect.objectContaining({
        auth: expect.objectContaining({ persistSession: false, autoRefreshToken: false }),
      })
    );
    expect(signInDaSessao).not.toHaveBeenCalled();
  });

  it('diz sim para senha certa e nao para errada', async () => {
    expect(await senhaConfere('pessoa@exemplo.invalid', 'certa')).toBe(true);

    signInAvulso.mockResolvedValue({ error: { message: 'Invalid login credentials' } });
    expect(await senhaConfere('pessoa@exemplo.invalid', 'errada')).toBe(false);
  });
});

describe('reautenticar', () => {
  // Aqui o client da sessao E o certo: o objetivo e justamente criar uma
  // sessao nova, com carimbo novo, e gravar os cookies dela. E isso que
  // reinicia a janela sem precisar de nada guardado em lugar nenhum.
  it('usa o client da sessao, nao o descartavel', async () => {
    await reautenticar('certa');

    expect(signInDaSessao).toHaveBeenCalledWith({
      email: usuario?.email,
      password: 'certa',
    });
    expect(signInAvulso).not.toHaveBeenCalled();
  });

  it('devolve false com senha errada', async () => {
    signInDaSessao.mockResolvedValue({ error: { message: 'nao' } });
    expect(await reautenticar('errada')).toBe(false);
  });

  // Refazer o login cria uma sessao NOVA. Sem encerrar a velha, ela fica na
  // lista de aparelhos conectados como um aparelho que a pessoa nao consegue
  // explicar — numa tela de seguranca, isso e pior que inutil.
  it('encerra a sessao velha, que ninguem mais segura', async () => {
    rpc.mockImplementation(async (f: string) =>
      f === 'minha_sessao_atual'
        ? { data: 'a'.repeat(64), error: null }
        : { data: true, error: null }
    );

    await reautenticar('certa');

    expect(rpc).toHaveBeenCalledWith('encerra_sessao', { p_identificador: 'a'.repeat(64) });
  });

  // A ordem e o que faz funcionar: enquanto a sessao velha for a atual,
  // `encerra_sessao` recusa apaga-la de proposito.
  it('le o identificador antes de refazer o login', async () => {
    rpc.mockImplementation(async (f: string) =>
      f === 'minha_sessao_atual'
        ? { data: 'a'.repeat(64), error: null }
        : { data: true, error: null }
    );

    await reautenticar('certa');

    const leitura = rpc.mock.calls.findIndex((c) => c[0] === 'minha_sessao_atual');
    const encerramento = rpc.mock.calls.findIndex((c) => c[0] === 'encerra_sessao');

    expect(leitura).toBeLessThan(encerramento);
    expect(rpc.mock.invocationCallOrder[leitura]).toBeLessThan(
      signInDaSessao.mock.invocationCallOrder[0]
    );
  });

  it('nao encerra nada se a senha estava errada', async () => {
    rpc.mockImplementation(async (f: string) =>
      f === 'minha_sessao_atual'
        ? { data: 'a'.repeat(64), error: null }
        : { data: true, error: null }
    );
    signInDaSessao.mockResolvedValue({ error: { message: 'nao' } });

    await reautenticar('errada');

    expect(rpc).not.toHaveBeenCalledWith('encerra_sessao', expect.anything());
  });

  it('devolve false sem sessao', async () => {
    usuario = null;
    expect(await reautenticar('certa')).toBe(false);
    expect(signInDaSessao).not.toHaveBeenCalled();
  });
});
