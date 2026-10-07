import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  autenticadoRecentemente,
  JANELA_MINUTOS,
  reautenticar,
  senhaConfere,
} from './reautenticacao';

type ErroDeAuth = { message: string; code?: string; status?: number } | null;

/** Como o Supabase responde a senha errada: codigo proprio, 400. */
const SENHA_ERRADA: ErroDeAuth = {
  message: 'Invalid login credentials',
  code: 'invalid_credentials',
  status: 400,
};
/** Limite do Supabase estourado: nao diz nada sobre a senha. */
const LIMITE: ErroDeAuth = {
  message: 'Request rate limit reached',
  code: 'over_request_rate_limit',
  status: 429,
};
/** Rede caiu antes da resposta: sem codigo e sem status. */
const REDE: ErroDeAuth = { message: 'fetch failed' };

const signInAvulso = vi.fn(async (_: { email: string; password: string }) => ({
  error: null as ErroDeAuth,
}));
const signOutAvulso = vi.fn(async (_?: { scope: string }) => ({ error: null }));
const opcoesDoAvulso = vi.fn();

vi.mock('@supabase/supabase-js', () => ({
  createClient: (_url: string, _chave: string, opcoes: unknown) => {
    opcoesDoAvulso(opcoes);
    return { auth: { signInWithPassword: signInAvulso, signOut: signOutAvulso } };
  },
}));

let usuario: { id: string; email: string } | null = null;
let lembrar = true;
const rpc = vi.fn(async (_f: string, _a?: unknown) => ({
  data: true as unknown,
  error: null as { message: string } | null,
}));
const signInDaSessao = vi.fn(async (_: { email: string; password: string }) => ({
  error: null as ErroDeAuth,
}));
const clienteDeAuth = vi.fn(async (_lembrar: boolean) => ({
  auth: { signInWithPassword: signInDaSessao },
}));

vi.mock('@/lib/supabase/servidor', () => ({
  usuarioDaSessao: async () => usuario,
  clienteServidor: async () => ({ rpc }),
  clienteDeAuth: (l: boolean) => clienteDeAuth(l),
  lembrarDaSessao: async () => lembrar,
  cabecalhosDeOrigem: async () => ({ 'User-Agent': 'Pixel 8', 'X-Forwarded-For': '203.0.113.7' }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  usuario = { id: 'u1', email: 'pessoa@exemplo.invalid' };
  lembrar = true;
  rpc.mockResolvedValue({ data: true, error: null });
  signInAvulso.mockResolvedValue({ error: null });
  signOutAvulso.mockResolvedValue({ error: null });
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

  // Sem isto a sessao nasce com o IP da Vercel, e o limite por IP do Supabase
  // conta contra o IP de saida — que e de todo mundo.
  it('repassa o navegador e o IP de quem digitou', async () => {
    await senhaConfere('pessoa@exemplo.invalid', 'certa');

    expect(opcoesDoAvulso).toHaveBeenCalledWith(
      expect.objectContaining({
        global: { headers: { 'User-Agent': 'Pixel 8', 'X-Forwarded-For': '203.0.113.7' } },
      })
    );
  });

  it('diz certa para senha certa e errada para senha errada', async () => {
    expect(await senhaConfere('pessoa@exemplo.invalid', 'certa')).toBe('certa');

    signInAvulso.mockResolvedValue({ error: SENHA_ERRADA });
    expect(await senhaConfere('pessoa@exemplo.invalid', 'errada')).toBe('errada');
  });

  // No pico do lancamento varias pessoas confirmam senha pelo mesmo IP de
  // saida. Quando o limite do Supabase estoura, dizer "senha incorreta" para
  // todas elas — digitando a senha certa — e o pior recado possivel.
  it.each([
    ['limite do Supabase', LIMITE],
    ['rede sem resposta', REDE],
    ['erro interno', { message: 'boom', code: 'unexpected_failure', status: 500 }],
  ])('%s nao vira senha errada: indisponivel', async (_nome, erro) => {
    signInAvulso.mockResolvedValue({ error: erro });
    expect(await senhaConfere('pessoa@exemplo.invalid', 'certa')).toBe('indisponivel');
  });

  // O login criou uma sessao real no Supabase. `persistSession: false` so
  // evita gravar em disco. Sem encerrar, ela vira um aparelho que a pessoa
  // nao reconhece em "Aparelhos conectados" — numa tela que manda trocar a
  // senha quando isso acontece.
  it('encerra a sessao que criou, e so ela', async () => {
    await senhaConfere('pessoa@exemplo.invalid', 'certa');

    expect(signOutAvulso).toHaveBeenCalledWith({ scope: 'local' });
    expect(signOutAvulso).not.toHaveBeenCalledWith({ scope: 'global' });
  });

  it('encerra depois de entrar, nunca antes', async () => {
    await senhaConfere('pessoa@exemplo.invalid', 'certa');

    expect(signInAvulso.mock.invocationCallOrder[0]).toBeLessThan(
      signOutAvulso.mock.invocationCallOrder[0]
    );
  });

  it('nao ha o que encerrar quando a senha nao conferiu', async () => {
    signInAvulso.mockResolvedValue({ error: SENHA_ERRADA });
    await senhaConfere('pessoa@exemplo.invalid', 'errada');

    signInAvulso.mockResolvedValue({ error: LIMITE });
    await senhaConfere('pessoa@exemplo.invalid', 'certa');

    expect(signOutAvulso).not.toHaveBeenCalled();
  });

  // A senha conferiu; e isso que a acao quer saber. A sessao sobrando e
  // higiene, nao decisao — barrar a troca por causa dela puniria a pessoa
  // certa por uma falha que nao e dela.
  it('a resposta continua certa se o encerramento falhar', async () => {
    signOutAvulso.mockResolvedValue({ error: { message: 'caiu' } as never });
    expect(await senhaConfere('pessoa@exemplo.invalid', 'certa')).toBe('certa');
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

  it('devolve certa com senha certa e errada com senha errada', async () => {
    expect(await reautenticar('certa')).toBe('certa');

    signInDaSessao.mockResolvedValue({ error: SENHA_ERRADA });
    expect(await reautenticar('errada')).toBe('errada');
  });

  it.each([
    ['limite do Supabase', LIMITE],
    ['rede sem resposta', REDE],
  ])('%s e indisponivel, nao senha errada', async (_nome, erro) => {
    signInDaSessao.mockResolvedValue({ error: erro });
    expect(await reautenticar('certa')).toBe('indisponivel');
  });

  // A sessao nova herda a escolha da antiga. Com `true` fixo, quem nao marcou
  // "manter conectado" num computador emprestado saia do modal com cookies
  // de trinta dias so por ter confirmado a senha.
  it('respeita a escolha de manter conectado, nas duas direcoes', async () => {
    lembrar = true;
    await reautenticar('certa');
    expect(clienteDeAuth).toHaveBeenLastCalledWith(true);

    lembrar = false;
    await reautenticar('certa');
    expect(clienteDeAuth).toHaveBeenLastCalledWith(false);
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

  it.each([
    ['errada', SENHA_ERRADA],
    ['nao conferida', LIMITE],
  ])('nao encerra nada se a senha estava %s', async (_nome, erro) => {
    rpc.mockImplementation(async (f: string) =>
      f === 'minha_sessao_atual'
        ? { data: 'a'.repeat(64), error: null }
        : { data: true, error: null }
    );
    signInDaSessao.mockResolvedValue({ error: erro });

    await reautenticar('errada');

    expect(rpc).not.toHaveBeenCalledWith('encerra_sessao', expect.anything());
  });

  // Sem sessao nao ha o que conferir, e "senha incorreta" seria mentira.
  it('sem sessao e indisponivel, sem tentar o login', async () => {
    usuario = null;
    expect(await reautenticar('certa')).toBe('indisponivel');
    expect(signInDaSessao).not.toHaveBeenCalled();
  });
});
