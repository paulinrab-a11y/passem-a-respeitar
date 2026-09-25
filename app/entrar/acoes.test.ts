import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { entrar } from './acoes';
import { estadoInicial } from './estado';

const signInWithPassword = vi.fn(async (_: { email: string; password: string }) => ({
  error: null as { message: string } | null,
}));
const clienteDeAuth = vi.fn(async (_lembrar: boolean) => ({
  auth: { signInWithPassword },
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

  it('e a mesma para conta nao confirmada', async () => {
    signInWithPassword.mockResolvedValue({ error: { message: 'Invalid login credentials' } });
    const a = await entrar(estadoInicial, formulario({ email: email(), senha: 'x' }));

    deIpNovo();
    // O Supabase responde "Email not confirmed" neste caso, o que contaria que
    // a conta existe. A acao nao repassa a mensagem dele.
    signInWithPassword.mockResolvedValue({ error: { message: 'Email not confirmed' } });
    const b = await entrar(estadoInicial, formulario({ email: email(), senha: 'x' }));

    expect(a.erro).toBe(b.erro);
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
