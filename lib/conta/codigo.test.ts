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

const {
  cabeConferencia,
  cabeReenvio,
  cabeReenvioDoEmail,
  cabeReenvioDoIp,
  codigoDaContaConfere,
  mandaCodigo,
} = await import('./codigo');

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
  // confirmada: o login chama esta funcao, o botao as duas de baixo, e as
  // chaves sao as mesmas.
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

  // O botao de reenviar confere os dois em momentos diferentes, o do e-mail
  // so depois do desafio. Separados, continuam sendo os contadores do login.
  it('o limite do e-mail, sozinho, e o mesmo contador do login', async () => {
    const alvo = email();
    expect(await cabeReenvioDoEmail(alvo)).toBe(true);
    expect(await cabeReenvioDoEmail(alvo)).toBe(true);
    expect(await cabeReenvio(alvo, ip())).toBe(true);

    expect(await cabeReenvioDoEmail(alvo)).toBe(false);
  });

  it('o do IP tambem', async () => {
    const origem = ip();
    for (let i = 0; i < 3; i++) expect(await cabeReenvioDoIp(origem)).toBe(true);
    for (let i = 0; i < 2; i++) expect(await cabeReenvio(email(), origem)).toBe(true);

    expect(await cabeReenvioDoIp(origem)).toBe(false);
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
    const enviado = await mandaCodigo(
      { resend } as never,
      'maria@exemplo.invalid',
      new Headers({ host: 'passem-a-respeitar.test' })
    );

    expect(enviado).toBe(true);
    expect(resend).toHaveBeenCalledWith({
      type: 'signup',
      email: 'maria@exemplo.invalid',
      options: { emailRedirectTo: 'https://passem-a-respeitar.test/auth/callback?next=%2Fconta' },
    });
  });

  // O erro nao sobe como excecao: vira `false`. O botao de reenviar ignora
  // (o 429 so acontece com cadastro pendente); o login, que ja conferiu a
  // senha, usa para nao dizer "enviamos" quando nada saiu.
  it('o erro do Supabase vira falso, sem lancar', async () => {
    const resend = vi.fn(async (_: unknown) => ({
      data: {},
      error: { message: 'For security purposes…', status: 429 },
    }));

    await expect(
      mandaCodigo({ resend } as never, 'maria@exemplo.invalid', new Headers())
    ).resolves.toBe(false);
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
