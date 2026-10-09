import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * O codigo de confirmacao do lado do servidor (#224, #260): os limites que o
 * cadastro, o login e /conta dividem, o pedido de codigo novo e a conferencia
 * de quem ja tem sessao.
 */
const verifyOtp = vi.fn(async (_: unknown) => ({ error: null as { message: string } | null }));
const signOut = vi.fn(async (_: unknown) => ({ error: null }));
const createClient = vi.fn((..._: unknown[]) => ({ auth: { verifyOtp, signOut } }));

vi.mock('@supabase/supabase-js', () => ({
  createClient: (...a: unknown[]) => createClient(...a),
}));
vi.mock('@/lib/supabase/servidor', () => ({
  cabecalhosDeOrigem: async () => ({ 'User-Agent': 'navegador de teste' }),
}));

const { cabeConferencia, cabeReenvio, codigoDaContaConfere, mandaCodigo } = await import(
  './codigo'
);

let n = 0;
const email = () => `pessoa${n++}@exemplo.invalid`;
const ip = () => `203.0.113.${n++ % 250}`;

beforeEach(() => {
  vi.clearAllMocks();
  verifyOtp.mockResolvedValue({ error: null });
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
});

describe('cabeReenvio', () => {
  // A cota e uma so para o botao de reenviar e para o login de conta nao
  // confirmada: os dois chamam esta funcao, com as mesmas chaves.
  it('tres codigos por e-mail na hora, mesmo trocando de IP', async () => {
    const alvo = email();
    for (let i = 0; i < 3; i++) expect(await cabeReenvio(alvo, ip())).toBe(true);

    expect(await cabeReenvio(alvo, ip())).toBe(false);
  });

  it('cinco por IP na hora, mesmo trocando de e-mail', async () => {
    const origem = ip();
    for (let i = 0; i < 5; i++) expect(await cabeReenvio(email(), origem)).toBe(true);

    expect(await cabeReenvio(email(), origem)).toBe(false);
  });
});

describe('cabeConferencia', () => {
  it('dez chutes por alvo em dez minutos, mesmo trocando de IP', async () => {
    const alvo = `email:${email()}` as const;
    for (let i = 0; i < 10; i++) expect(await cabeConferencia(alvo, ip())).toBe(true);

    expect(await cabeConferencia(alvo, ip())).toBe(false);
  });

  it('a conta e o e-mail sao contadores separados', async () => {
    const id = `conta:${n++}` as const;
    for (let i = 0; i < 10; i++) await cabeConferencia(id, ip());

    expect(await cabeConferencia(id, ip())).toBe(false);
    expect(await cabeConferencia(`email:${email()}`, ip())).toBe(true);
  });

  it('vinte por IP, mesmo trocando de alvo', async () => {
    const origem = ip();
    for (let i = 0; i < 20; i++) {
      expect(await cabeConferencia(`email:${email()}`, origem)).toBe(true);
    }

    expect(await cabeConferencia(`email:${email()}`, origem)).toBe(false);
  });
});

describe('mandaCodigo', () => {
  it('pede outro e-mail de cadastro, com a volta pelo callback do site', async () => {
    const resend = vi.fn(async (_: unknown) => ({ data: {}, error: null }));
    await mandaCodigo(
      { resend } as never,
      'maria@exemplo.invalid',
      new Headers({ host: 'passem-a-respeitar.test' })
    );

    expect(resend).toHaveBeenCalledWith({
      type: 'signup',
      email: 'maria@exemplo.invalid',
      options: { emailRedirectTo: 'https://passem-a-respeitar.test/auth/callback?next=%2Fconta' },
    });
  });

  // O erro nao sobe: e o intervalo minimo do Supabase, que so acontece com
  // cadastro pendente. Quem chama nao tem o que fazer com ele.
  it('o erro do Supabase nao sobe', async () => {
    const resend = vi.fn(async (_: unknown) => ({
      data: {},
      error: { message: 'For security purposes…', status: 429 },
    }));

    await expect(
      mandaCodigo({ resend } as never, 'maria@exemplo.invalid', new Headers())
    ).resolves.toBeUndefined();
  });
});

describe('codigoDaContaConfere', () => {
  it('confere num client que nao grava nada, e encerra a sessao que nasceu', async () => {
    expect(await codigoDaContaConfere('maria@exemplo.invalid', '12345678')).toBe(true);

    const opcoes = createClient.mock.calls[0][2] as {
      auth: { persistSession: boolean; autoRefreshToken: boolean };
      global: { headers: Record<string, string> };
    };
    expect(opcoes.auth).toEqual({ persistSession: false, autoRefreshToken: false });
    // A sessao descartavel leva o navegador de quem pediu, nao o do servidor.
    expect(opcoes.global.headers['User-Agent']).toBe('navegador de teste');
    expect(verifyOtp).toHaveBeenCalledWith({
      email: 'maria@exemplo.invalid',
      token: '12345678',
      type: 'email',
    });
    // `local`: so a que acabou de nascer. `global` derrubaria a da pessoa.
    expect(signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('codigo recusado: falso, e nenhuma sessao para encerrar', async () => {
    verifyOtp.mockResolvedValue({ error: { message: 'Token has expired or is invalid' } });

    expect(await codigoDaContaConfere('maria@exemplo.invalid', '00000000')).toBe(false);
    expect(signOut).not.toHaveBeenCalled();
  });
});
