import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { entrar } from './acoes';
import { estadoInicial } from './estado';

type ErroDoSupabase = { message: string; code?: string; status?: number } | null;

const signInWithPassword = vi.fn(async (_: { email: string; password: string }) => ({
  error: null as ErroDoSupabase,
}));
const resend = vi.fn(async (_: unknown) => ({ error: null as ErroDoSupabase }));
const clienteDeAuth = vi.fn(async (_lembrar: boolean) => ({
  auth: { signInWithPassword, resend },
}));

/** O que o Supabase responde a senha CERTA de conta que nunca confirmou. */
const NAO_CONFIRMADA = { message: 'Email not confirmed', code: 'email_not_confirmed', status: 400 };
/** E a senha errada — de conta pendente, confirmada ou de e-mail que nao existe. */
const CREDENCIAL_ERRADA = {
  message: 'Invalid login credentials',
  code: 'invalid_credentials',
  status: 400,
};

const captureMessage = vi.fn();
const flush = vi.fn(async () => true);
vi.mock('@sentry/nextjs', () => ({
  captureMessage: (...a: unknown[]) => captureMessage(...a),
  flush: () => flush(),
}));

vi.mock('@/lib/supabase/servidor', () => ({
  clienteDeAuth: (lembrar: boolean) => clienteDeAuth(lembrar),
}));

const jarSet = vi.fn();
let cabecalhos = new Headers();

vi.mock('next/headers', () => ({
  cookies: async () => ({ set: jarSet }),
  headers: async () => cabecalhos,
}));

/** `redirect` funciona lancando. O duble imita isso para o teste ver o destino. */
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

function formulario(campos: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.append(k, v);
  return f;
}

/** E-mail novo a cada caso: o rate limit por e-mail guarda estado no modulo. */
let n = 0;
const email = () => `pessoa${n++}@exemplo.invalid`;

/** IP novo a cada caso, pelo mesmo motivo. */
function deIpNovo() {
  cabecalhos = new Headers({ 'x-forwarded-for': `203.0.113.${n % 250}` });
}

beforeEach(() => {
  vi.clearAllMocks();
  signInWithPassword.mockResolvedValue({ error: null });
  resend.mockResolvedValue({ error: null });
  deIpNovo();
  // O piso de tempo (#23) e testado num caso proprio; nos outros ele so
  // deixaria a suite lenta.
  vi.stubEnv('LOGIN_PISO_MS', '0');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('login com sucesso', () => {
  it('manda para /conta', async () => {
    const f = formulario({ email: email(), senha: 'certa' });
    await expect(entrar(estadoInicial, f)).rejects.toThrow('redirect:/conta');
  });

  it('respeita o next quando e rota de conta', async () => {
    const f = formulario({ email: email(), senha: 'certa', next: '/conta/pedidos' });
    await expect(entrar(estadoInicial, f)).rejects.toThrow('redirect:/conta/pedidos');
  });

  // O `next` ja foi validado na pagina, mas e revalidado aqui: o formulario
  // e HTML, e qualquer um monta um POST proprio com o campo que quiser.
  it('nunca redireciona para fora do site', async () => {
    const f = formulario({
      email: email(),
      senha: 'certa',
      next: 'https://site-que-imita.com',
    });
    await expect(entrar(estadoInicial, f)).rejects.toThrow('redirect:/conta');
  });

  it('registra a escolha de manter conectado', async () => {
    const f = formulario({ email: email(), senha: 'certa', lembrar: 'on' });
    await expect(entrar(estadoInicial, f)).rejects.toThrow();

    expect(clienteDeAuth).toHaveBeenCalledWith(true);
    expect(jarSet).toHaveBeenCalledWith('par_lembrar', '1', expect.objectContaining({ path: '/' }));
  });

  it('registra tambem quando a caixa fica desmarcada', async () => {
    const f = formulario({ email: email(), senha: 'certa' });
    await expect(entrar(estadoInicial, f)).rejects.toThrow();

    expect(clienteDeAuth).toHaveBeenCalledWith(false);
    expect(jarSet).toHaveBeenCalledWith('par_lembrar', '0', expect.anything());
  });

  it('manda o e-mail normalizado ao Supabase', async () => {
    const e = email();
    await expect(
      entrar(estadoInicial, formulario({ email: `  ${e.toUpperCase()} `, senha: 'certa' }))
    ).rejects.toThrow();

    expect(signInWithPassword).toHaveBeenCalledWith({ email: e, password: 'certa' });
  });
});

describe('mensagem generica', () => {
  // O criterio da Issue: a resposta para e-mail inexistente e para senha
  // errada tem que ser identica. Qualquer diferenca vira oraculo de cadastro —
  // o atacante roda uma lista de e-mails e sai com a lista de quem tem conta.
  it('e a mesma para credencial errada e para formato invalido', async () => {
    signInWithPassword.mockResolvedValue({ error: { message: 'Invalid login credentials' } });
    const credencialErrada = await entrar(
      estadoInicial,
      formulario({ email: email(), senha: 'x' })
    );

    deIpNovo();
    const formatoInvalido = await entrar(
      estadoInicial,
      formulario({ email: 'nao-e-email', senha: 'x' })
    );

    expect(credencialErrada.erro).toBe(formatoInvalido.erro);
    expect(credencialErrada.erro).toBeTruthy();
  });

  // Conta nao confirmada com a senha ERRADA recebe `invalid_credentials`: o
  // Supabase confere a senha antes de olhar a confirmacao (#260). So o codigo
  // `email_not_confirmed` abre a tela do codigo; a frase solta, sem ele, cai
  // na mensagem generica, que e o lado seguro.
  it('a frase "Email not confirmed" sem o codigo do erro nao abre nada', async () => {
    signInWithPassword.mockResolvedValue({ error: { message: 'Invalid login credentials' } });
    const a = await entrar(estadoInicial, formulario({ email: email(), senha: 'x' }));

    deIpNovo();
    signInWithPassword.mockResolvedValue({ error: { message: 'Email not confirmed' } });
    const b = await entrar(estadoInicial, formulario({ email: email(), senha: 'x' }));

    expect(a.erro).toBe(b.erro);
    expect(b.confirmar).toBeUndefined();
    expect(resend).not.toHaveBeenCalled();
  });

  // A mensagem antiga mandava cadastrar de novo, e o Supabase descarta a
  // senha do segundo cadastro (#260). A recuperacao confirma o e-mail e deixa
  // uma senha conhecida.
  it('aponta a recuperacao de senha, e nao um cadastro novo', async () => {
    signInWithPassword.mockResolvedValue({ error: CREDENCIAL_ERRADA });
    const r = await entrar(estadoInicial, formulario({ email: email(), senha: 'x' }));

    expect(r.erro).toMatch(/Esqueci minha senha/);
    expect(r.erro).toMatch(/confirma o e-mail/);
    expect(r.erro).not.toMatch(/cadastro/i);
  });

  it('nunca repassa a mensagem do Supabase', async () => {
    signInWithPassword.mockResolvedValue({ error: { message: 'Email not confirmed' } });
    const r = await entrar(estadoInicial, formulario({ email: email(), senha: 'x' }));

    expect(r.erro).not.toMatch(/not confirmed/i);
    expect(r.erro).not.toMatch(/invalid/i);
  });

  it('nao chama o Supabase quando a entrada nem passa no schema', async () => {
    await entrar(estadoInicial, formulario({ email: 'nao-e-email', senha: 'x' }));
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it('muda a tentativa a cada envio, para o erro reanimar', async () => {
    signInWithPassword.mockResolvedValue({ error: { message: 'Invalid login credentials' } });

    const a = await entrar(estadoInicial, formulario({ email: email(), senha: 'x' }));
    const b = await entrar(a, formulario({ email: email(), senha: 'x' }));

    expect(b.tentativa).not.toBe(a.tentativa);
  });
});

describe('rate limit', () => {
  it('bloqueia depois de cinco tentativas no mesmo e-mail', async () => {
    signInWithPassword.mockResolvedValue({ error: { message: 'Invalid login credentials' } });
    const alvo = email();

    for (let i = 0; i < 5; i++) {
      const r = await entrar(estadoInicial, formulario({ email: alvo, senha: 'x' }));
      expect(r.erro).not.toMatch(/Muitas tentativas/);
    }

    const bloqueado = await entrar(estadoInicial, formulario({ email: alvo, senha: 'x' }));
    expect(bloqueado.erro).toMatch(/Muitas tentativas/);
  });

  // Este e o limite que o de IP nao cobre: botnet troca de IP a cada
  // tentativa, mas o alvo continua o mesmo.
  it('o limite por e-mail segue o alvo mesmo trocando de IP', async () => {
    signInWithPassword.mockResolvedValue({ error: { message: 'Invalid login credentials' } });
    const alvo = email();

    for (let i = 0; i < 5; i++) {
      cabecalhos = new Headers({ 'x-forwarded-for': `198.51.100.${i}` });
      await entrar(estadoInicial, formulario({ email: alvo, senha: 'x' }));
    }

    cabecalhos = new Headers({ 'x-forwarded-for': '198.51.100.200' });
    const bloqueado = await entrar(estadoInicial, formulario({ email: alvo, senha: 'x' }));
    expect(bloqueado.erro).toMatch(/Muitas tentativas/);
  });

  it('nao tenta autenticar quando ja esta bloqueado', async () => {
    signInWithPassword.mockResolvedValue({ error: { message: 'Invalid login credentials' } });
    const alvo = email();

    for (let i = 0; i < 6; i++) {
      await entrar(estadoInicial, formulario({ email: alvo, senha: 'x' }));
    }
    signInWithPassword.mockClear();

    await entrar(estadoInicial, formulario({ email: alvo, senha: 'x' }));
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  // Este erro pode ser diferente do generico: ele nao diz nada sobre a conta
  // existir, e esconder o motivo faria a pessoa achar que esqueceu a senha.
  it('diz quanto tempo falta', async () => {
    signInWithPassword.mockResolvedValue({ error: { message: 'Invalid login credentials' } });
    const alvo = email();

    for (let i = 0; i < 6; i++) {
      await entrar(estadoInicial, formulario({ email: alvo, senha: 'x' }));
    }

    const r = await entrar(estadoInicial, formulario({ email: alvo, senha: 'x' }));
    expect(r.erro).toMatch(/\d+ minutos?/);
  });

  it('um e-mail bloqueado nao bloqueia outro', async () => {
    signInWithPassword.mockResolvedValue({ error: { message: 'Invalid login credentials' } });
    const alvo = email();

    for (let i = 0; i < 6; i++) {
      await entrar(estadoInicial, formulario({ email: alvo, senha: 'x' }));
    }

    deIpNovo();
    const outro = await entrar(estadoInicial, formulario({ email: email(), senha: 'x' }));
    expect(outro.erro).not.toMatch(/Muitas tentativas/);
  });
});

describe('tempo de resposta', () => {
  // A mensagem ja era igual; o tempo ainda contava. Sem hash para comparar, o
  // provedor responde mais rapido para e-mail que nao existe — e quem mede
  // milissegundos enumera contas do mesmo jeito.
  it('e-mail inexistente nao responde mais rapido que senha errada', async () => {
    vi.stubEnv('LOGIN_PISO_MS', '80');

    // Conta que "nao existe": o provedor responde na hora.
    signInWithPassword.mockResolvedValue({ error: { message: 'Invalid login credentials' } });
    const t0 = Date.now();
    await entrar(estadoInicial, formulario({ email: email(), senha: 'x' }));
    const inexistente = Date.now() - t0;

    // Conta que existe: o provedor demora comparando o hash.
    deIpNovo();
    signInWithPassword.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 40));
      return { error: { message: 'Invalid login credentials' } };
    });
    const t1 = Date.now();
    await entrar(estadoInicial, formulario({ email: email(), senha: 'x' }));
    const existente = Date.now() - t1;

    expect(inexistente).toBeGreaterThanOrEqual(75);
    expect(existente).toBeGreaterThanOrEqual(75);
  });

  it('o piso vale tambem para o sucesso', async () => {
    vi.stubEnv('LOGIN_PISO_MS', '80');
    const t0 = Date.now();
    await expect(
      entrar(estadoInicial, formulario({ email: email(), senha: 'certa' }))
    ).rejects.toThrow();
    expect(Date.now() - t0).toBeGreaterThanOrEqual(75);
  });

  it('nao segura alem do piso quando o provedor ja demorou', async () => {
    vi.stubEnv('LOGIN_PISO_MS', '50');
    signInWithPassword.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 120));
      return { error: { message: 'Invalid login credentials' } };
    });
    const t0 = Date.now();
    await entrar(estadoInicial, formulario({ email: email(), senha: 'x' }));
    expect(Date.now() - t0).toBeLessThan(200);
  });
});

describe('sinal para o alerta (#8)', () => {
  it('bater no limite manda um aviso ao Sentry, sem e-mail nem IP', async () => {
    signInWithPassword.mockResolvedValue({ error: { message: 'Invalid login credentials' } });
    const alvo = email();
    for (let i = 0; i < 6; i++)
      await entrar(estadoInicial, formulario({ email: alvo, senha: 'x' }));

    expect(captureMessage).toHaveBeenCalledTimes(1);
    const [mensagem, contexto] = captureMessage.mock.calls[0] as [
      string,
      { tags: Record<string, string> },
    ];
    expect(mensagem).toMatch(/limite/);
    expect(contexto.tags).toEqual({ por: 'email' });
    expect(JSON.stringify(captureMessage.mock.calls)).not.toContain(alvo);
    expect(JSON.stringify(captureMessage.mock.calls)).not.toMatch(/203.0.113/);
  });

  // Serverless congela ao responder; sem flush o evento morre na fila.
  it('faz flush depois de capturar, antes de responder', async () => {
    signInWithPassword.mockResolvedValue({ error: { message: 'Invalid login credentials' } });
    const alvo = email();
    for (let i = 0; i < 6; i++)
      await entrar(estadoInicial, formulario({ email: alvo, senha: 'x' }));

    expect(flush).toHaveBeenCalledTimes(1);
    expect(captureMessage.mock.invocationCallOrder[0]).toBeLessThan(
      flush.mock.invocationCallOrder[0]
    );
  });

  it('tentativa errada comum nao vira evento', async () => {
    signInWithPassword.mockResolvedValue({ error: { message: 'Invalid login credentials' } });
    await entrar(estadoInicial, formulario({ email: email(), senha: 'x' }));

    expect(captureMessage).not.toHaveBeenCalled();
  });
});

/**
 * Conta que nunca confirmou o e-mail (#260). Quem saiu da tela do codigo do
 * cadastro volta por aqui: com a senha certa, o login da lugar a tela do
 * codigo e manda um codigo novo.
 */
describe('conta que nunca confirmou o e-mail (#260)', () => {
  it('a senha certa abre a tela do codigo e manda um codigo novo', async () => {
    signInWithPassword.mockResolvedValue({ error: NAO_CONFIRMADA });
    const e = email();
    const r = await entrar(estadoInicial, formulario({ email: e, senha: 'certa' }));

    expect(r).toEqual({
      erro: null,
      campo: null,
      tentativa: 1,
      confirmar: { email: e, lembrar: false },
    });
    expect(resend).toHaveBeenCalledWith({
      type: 'signup',
      email: e,
      options: { emailRedirectTo: expect.stringMatching(/\/auth\/callback\?next=%2Fconta$/) },
    });
  });

  // Ainda nao ha sessao: a escolha so vira cookie depois do codigo.
  it('leva o manter conectado para a tela, sem gravar cookie', async () => {
    signInWithPassword.mockResolvedValue({ error: NAO_CONFIRMADA });
    const r = await entrar(
      estadoInicial,
      formulario({ email: email(), senha: 'certa', lembrar: 'on' })
    );

    expect(r.confirmar?.lembrar).toBe(true);
    expect(clienteDeAuth).toHaveBeenCalledWith(true);
    expect(jarSet).not.toHaveBeenCalled();
  });

  // O que impede a tela do codigo de virar oraculo de cadastro: sem a senha,
  // conta pendente, conta confirmada e e-mail desconhecido sao a mesma coisa.
  it('senha errada e e-mail desconhecido: a mesma mensagem, e nenhum codigo', async () => {
    signInWithPassword.mockResolvedValue({ error: CREDENCIAL_ERRADA });
    const pendente = await entrar(estadoInicial, formulario({ email: email(), senha: 'x' }));
    deIpNovo();
    const desconhecido = await entrar(estadoInicial, formulario({ email: email(), senha: 'x' }));

    expect(pendente.erro).toBe(desconhecido.erro);
    expect(pendente.confirmar).toBeUndefined();
    expect(desconhecido.confirmar).toBeUndefined();
    expect(resend).not.toHaveBeenCalled();
  });

  // As chaves sao as do botao de reenviar (3 por e-mail por hora): alternar
  // entre entrar e reenviar nao manda mais e-mail que o botao sozinho.
  it('cota do reenvio gasta: a tela aparece igual, sem e-mail novo', async () => {
    signInWithPassword.mockResolvedValue({ error: NAO_CONFIRMADA });
    const alvo = email();

    for (let i = 0; i < 4; i++) {
      const r = await entrar(estadoInicial, formulario({ email: alvo, senha: 'certa' }));
      expect(r.erro).toBeNull();
      expect(r.confirmar?.email).toBe(alvo);
    }

    expect(resend).toHaveBeenCalledTimes(3);
  });

  // No 429 o codigo anterior continua valendo; dizer outra coisa so contaria
  // que ha cadastro pendente a quem ja provou a senha — e nao ajudaria.
  it('o intervalo minimo do Supabase nao muda a resposta', async () => {
    signInWithPassword.mockResolvedValue({ error: NAO_CONFIRMADA });
    resend.mockResolvedValue({
      error: { message: 'For security purposes…', code: 'over_email_send_rate_limit', status: 429 },
    });

    const r = await entrar(estadoInicial, formulario({ email: email(), senha: 'certa' }));

    expect(r.erro).toBeNull();
    expect(r.confirmar).toBeTruthy();
  });

  it('nunca entra: nada de redirect nem de cookie', async () => {
    signInWithPassword.mockResolvedValue({ error: NAO_CONFIRMADA });

    await expect(
      entrar(estadoInicial, formulario({ email: email(), senha: 'certa', next: '/checkout' }))
    ).resolves.toBeTruthy();
    expect(jarSet).not.toHaveBeenCalled();
  });

  it('respeita o piso de tempo', async () => {
    vi.stubEnv('LOGIN_PISO_MS', '80');
    signInWithPassword.mockResolvedValue({ error: NAO_CONFIRMADA });

    const t0 = Date.now();
    await entrar(estadoInicial, formulario({ email: email(), senha: 'certa' }));
    expect(Date.now() - t0).toBeGreaterThanOrEqual(75);
  });
});
