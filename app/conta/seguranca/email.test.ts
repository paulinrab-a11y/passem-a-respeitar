import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Troca de e-mail (#36). O que se prova: sem senha certa nada sai; a resposta
 * nao conta se o endereco novo ja tem conta; o link volta para este site; e o
 * pedido e limitado por conta.
 */
let n = 0;
let usuario: { id: string; email: string } | null = null;
let lembrar: string | undefined;
let cabecalhos = new Headers();

const confere = vi.fn(async (_email: string, _senha: string) => true);
vi.mock('@/lib/conta/reautenticacao', () => ({
  senhaConfere: (email: string, senha: string) => confere(email, senha),
}));

type ErroDoSupabase = { code?: string; status?: number; message: string } | null;
const updateUser = vi.fn(async (_dados: unknown, _opcoes: unknown) => ({
  error: null as ErroDoSupabase,
}));
const rpc = vi.fn(async (_nome: string) => ({
  data: true as boolean | null,
  error: null as { message: string } | null,
}));
const clienteDeAuth = vi.fn(async (_lembrar: boolean) => ({ auth: { updateUser } }));

vi.mock('@/lib/supabase/servidor', () => ({
  usuarioDaSessao: async () => usuario,
  clienteDeAuth: (l: boolean) => clienteDeAuth(l),
  clienteServidor: async () => ({ rpc }),
}));

vi.mock('next/headers', () => ({
  headers: async () => cabecalhos,
  cookies: async () => ({
    get: (nome: string) =>
      nome === 'par_lembrar' && lembrar !== undefined ? { value: lembrar } : undefined,
  }),
}));

const revalidatePath = vi.fn();
vi.mock('next/cache', () => ({ revalidatePath: (c: string) => revalidatePath(c) }));

const { trocarEmail, cancelarTrocaDeEmail } = await import('./email');
const { emailInicial, cancelamentoInicial } = await import('./estado-email');

const ATUAL = 'pessoa@exemplo.invalid';

function pedido(campos: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.set(k, v);
  return f;
}

const bom = (extra: Record<string, string> = {}) =>
  pedido({ email: 'nova@exemplo.invalid', senha: 'a senha de agora', ...extra });

beforeEach(() => {
  vi.clearAllMocks();
  n += 1;
  // Conta e IP novos por teste: o limite guarda estado no modulo.
  usuario = { id: `usuario-${n}`, email: ATUAL };
  lembrar = '1';
  cabecalhos = new Headers({
    host: 'passem-a-respeitar.test',
    'x-forwarded-for': `203.0.113.${(n % 200) + 1}`,
  });
  confere.mockResolvedValue(true);
  updateUser.mockResolvedValue({ error: null });
  rpc.mockResolvedValue({ data: true, error: null });
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
  vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
  vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('pedido que da certo', () => {
  it('confere a senha contra o e-mail ATUAL e pede a troca para o novo', async () => {
    const r = await trocarEmail(emailInicial, bom());

    expect(confere).toHaveBeenCalledWith(ATUAL, 'a senha de agora');
    expect(updateUser).toHaveBeenCalledTimes(1);
    expect(updateUser.mock.calls[0][0]).toEqual({ email: 'nova@exemplo.invalid' });
    expect(r.recado?.tom).toBe('ok');
    expect(r.tentativa).toBe(1);
    expect(revalidatePath).toHaveBeenCalledWith('/conta/seguranca');
  });

  it('o link do e-mail volta para o callback deste site, com destino na seguranca', async () => {
    await trocarEmail(emailInicial, bom());

    const { emailRedirectTo } = updateUser.mock.calls[0][1] as { emailRedirectTo: string };
    const url = new URL(emailRedirectTo);

    expect(url.origin).toBe('https://passem-a-respeitar.test');
    expect(url.pathname).toBe('/auth/callback');
    expect(url.searchParams.get('next')).toBe('/conta/seguranca');
  });

  it('normaliza o endereco novo como o login normaliza', async () => {
    await trocarEmail(emailInicial, bom({ email: '  Nova@Exemplo.INVALID ' }));

    expect(updateUser.mock.calls[0][0]).toEqual({ email: 'nova@exemplo.invalid' });
  });

  it('respeita a escolha de manter conectado, nas duas direcoes', async () => {
    await trocarEmail(emailInicial, bom());
    expect(clienteDeAuth).toHaveBeenLastCalledWith(true);

    lembrar = '0';
    usuario = { id: `usuario-${n}-b`, email: ATUAL };
    await trocarEmail(emailInicial, bom());
    expect(clienteDeAuth).toHaveBeenLastCalledWith(false);
  });
});

describe('a resposta nao conta quem e cliente', () => {
  it('endereco que ja tem conta recebe a MESMA resposta de um pedido aceito', async () => {
    const aceito = await trocarEmail(emailInicial, bom());

    usuario = { id: `usuario-${n}-b`, email: ATUAL };
    updateUser.mockResolvedValue({
      error: { code: 'email_exists', status: 422, message: 'already registered' },
    });
    const repetido = await trocarEmail(emailInicial, bom({ email: 'dono@exemplo.invalid' }));

    expect(repetido).toEqual(aceito);
  });

  it('nao devolve o e-mail digitado nem a senha no estado', async () => {
    const r = await trocarEmail(emailInicial, bom());

    expect(JSON.stringify(r)).not.toContain('nova@exemplo.invalid');
    expect(JSON.stringify(r)).not.toContain('a senha de agora');
  });
});

describe('o que barra o pedido antes de sair e-mail', () => {
  it('sem sessao', async () => {
    usuario = null;
    const r = await trocarEmail(emailInicial, bom());

    expect(r.recado?.tom).toBe('erro');
    expect(confere).not.toHaveBeenCalled();
    expect(updateUser).not.toHaveBeenCalled();
  });

  it('senha errada: aponta o campo e nao chama o Supabase', async () => {
    confere.mockResolvedValue(false);
    const r = await trocarEmail(emailInicial, bom());

    expect(r.campo).toBe('senha');
    expect(r.recado?.tom).toBe('erro');
    expect(updateUser).not.toHaveBeenCalled();
  });

  it('senha vazia nem chega a ser conferida', async () => {
    const r = await trocarEmail(emailInicial, bom({ senha: '' }));

    expect(r.campo).toBe('senha');
    expect(confere).not.toHaveBeenCalled();
  });

  it('e-mail malformado', async () => {
    const r = await trocarEmail(emailInicial, bom({ email: 'nao-e-email' }));

    expect(r.campo).toBe('email');
    expect(confere).not.toHaveBeenCalled();
    expect(updateUser).not.toHaveBeenCalled();
  });

  it('o mesmo e-mail da conta, em qualquer caixa', async () => {
    const r = await trocarEmail(emailInicial, bom({ email: 'PESSOA@exemplo.invalid' }));

    expect(r.campo).toBe('email');
    expect(updateUser).not.toHaveBeenCalled();
  });
});

describe('falha do Supabase', () => {
  it('limite de envio vira pedido de espera', async () => {
    updateUser.mockResolvedValue({
      error: { code: 'over_email_send_rate_limit', status: 429, message: 'rate' },
    });
    const r = await trocarEmail(emailInicial, bom());

    expect(r.recado?.tom).toBe('erro');
    expect(r.recado?.texto).toMatch(/espere/i);
  });

  it('outro erro nao vira sucesso, e nao vaza a mensagem crua', async () => {
    updateUser.mockResolvedValue({
      error: { code: 'unexpected_failure', status: 500, message: 'pq: detalhe interno' },
    });
    const r = await trocarEmail(emailInicial, bom());

    expect(r.recado?.tom).toBe('erro');
    expect(r.recado?.texto).not.toContain('pq:');
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe('rate limit', () => {
  it('o quarto pedido da mesma conta na hora e recusado antes da senha', async () => {
    for (let i = 0; i < 3; i++) {
      expect((await trocarEmail(emailInicial, bom())).recado?.tom).toBe('ok');
    }

    vi.clearAllMocks();
    const r = await trocarEmail(emailInicial, bom());

    expect(r.recado?.tom).toBe('erro');
    expect(r.recado?.texto).toMatch(/muitas tentativas/i);
    expect(confere).not.toHaveBeenCalled();
    expect(updateUser).not.toHaveBeenCalled();
  });
});

describe('cancelar a troca pendente', () => {
  it('chama a funcao do banco, que nao recebe identificador nenhum', async () => {
    const r = await cancelarTrocaDeEmail(cancelamentoInicial, new FormData());

    expect(rpc).toHaveBeenCalledWith('cancela_troca_de_email');
    expect(r.recado?.tom).toBe('ok');
    expect(r.recado?.texto).toMatch(/cancelada/i);
    expect(revalidatePath).toHaveBeenCalledWith('/conta/seguranca');
  });

  it('sem troca pendente diz isso, sem erro', async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    const r = await cancelarTrocaDeEmail(cancelamentoInicial, new FormData());

    expect(r.recado?.tom).toBe('ok');
    expect(r.recado?.texto).toMatch(/não havia/i);
  });

  it('sem sessao nao chega ao banco', async () => {
    usuario = null;
    const r = await cancelarTrocaDeEmail(cancelamentoInicial, new FormData());

    expect(r.recado?.tom).toBe('erro');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('erro do banco vira recado de erro', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'falhou' } });
    const r = await cancelarTrocaDeEmail(cancelamentoInicial, new FormData());

    expect(r.recado?.tom).toBe('erro');
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('e limitado por conta', async () => {
    for (let i = 0; i < 10; i++) await cancelarTrocaDeEmail(cancelamentoInicial, new FormData());

    vi.clearAllMocks();
    const r = await cancelarTrocaDeEmail(cancelamentoInicial, new FormData());

    expect(r.recado?.tom).toBe('erro');
    expect(rpc).not.toHaveBeenCalled();
  });
});
