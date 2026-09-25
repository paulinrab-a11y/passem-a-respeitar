import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * O pedido de recuperacao e um oraculo classico. O que se prova: a resposta
 * e identica para conta existente, inexistente e ate para erro do provedor;
 * o link volta para o callback do proprio host; e o limite segura a rajada.
 */
const resetPasswordForEmail = vi.fn(async (_e: string, _o: unknown) => ({
  data: {},
  error: null as { message: string } | null,
}));
let cabecalhos = new Headers({ host: 'passem-a-respeitar.test' });

vi.mock('@/lib/supabase/servidor', () => ({
  clienteDeAuth: async () => ({ auth: { resetPasswordForEmail } }),
}));
vi.mock('next/headers', () => ({ headers: async () => cabecalhos }));

const { recuperarSenha } = await import('./acoes');
const { recuperarInicial } = await import('./estado');

let n = 0;
const email = () => `pessoa${n++}@exemplo.invalid`;

function formulario(campos: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.set(k, v);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
  cabecalhos = new Headers({
    host: 'passem-a-respeitar.test',
    'x-forwarded-for': `203.0.113.${(n % 200) + 1}`,
  });
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('resposta generica', () => {
  it('conta que existe: enviado', async () => {
    const r = await recuperarSenha(recuperarInicial, formulario({ email: email() }));
    expect(r).toMatchObject({ enviado: true, erro: null });
  });

  // O Supabase responde erro para e-mail desconhecido em alguns modos. A acao
  // nao repassa: a resposta e a mesma.
  it('conta que nao existe, mesmo com erro do provedor: a MESMA resposta', async () => {
    resetPasswordForEmail.mockResolvedValue({ data: {}, error: { message: 'User not found' } });
    const r = await recuperarSenha(recuperarInicial, formulario({ email: email() }));

    expect(r).toMatchObject({ enviado: true, erro: null });
    expect(JSON.stringify(r)).not.toMatch(/not found/i);
  });

  it('e-mail malformado nem chega ao provedor', async () => {
    const r = await recuperarSenha(recuperarInicial, formulario({ email: 'nao-e' }));

    expect(r.enviado).toBe(false);
    expect(resetPasswordForEmail).not.toHaveBeenCalled();
  });
});

describe('o link', () => {
  it('volta para o callback do proprio host, com destino na redefinicao', async () => {
    const e = email();
    await recuperarSenha(recuperarInicial, formulario({ email: ` ${e.toUpperCase()} ` }));

    expect(resetPasswordForEmail).toHaveBeenCalledWith(e, {
      redirectTo: 'https://passem-a-respeitar.test/auth/callback?next=%2Fredefinir-senha',
    });
  });
});

describe('limite', () => {
  it('para depois de cinco pedidos do mesmo IP', async () => {
    cabecalhos = new Headers({ host: 'h', 'x-forwarded-for': '198.51.100.240' });
    for (let i = 0; i < 5; i++)
      await recuperarSenha(recuperarInicial, formulario({ email: email() }));
    const r = await recuperarSenha(recuperarInicial, formulario({ email: email() }));

    expect(r.erro).toMatch(/muitos pedidos/i);
    expect(r.enviado).toBe(false);
  });

  // Nao encher a caixa de quem nao pediu, mesmo de IPs diferentes.
  it('para depois de tres pedidos para o mesmo e-mail', async () => {
    const alvo = 'alvo@exemplo.invalid';
    for (let i = 0; i < 3; i++) {
      cabecalhos = new Headers({ host: 'h', 'x-forwarded-for': `198.51.100.${20 + i}` });
      await recuperarSenha(recuperarInicial, formulario({ email: alvo }));
    }
    cabecalhos = new Headers({ host: 'h', 'x-forwarded-for': '198.51.100.99' });
    const r = await recuperarSenha(recuperarInicial, formulario({ email: alvo }));

    expect(r.erro).toMatch(/muitos pedidos/i);
    expect(resetPasswordForEmail).toHaveBeenCalledTimes(3);
  });
});
