import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * O que a acao de cadastro nunca faz: dizer que um e-mail ja existe, criar
 * conta sem aceite, aceitar senha vazada, ou deixar o cliente escolher a
 * hora do aceite.
 */
const signUp = vi.fn(async (_o: unknown) => ({
  data: { session: null as null | { access_token: string } },
  error: null as { message: string } | null,
}));
const senhaVazada = vi.fn(async (_s: string) => false);
let cabecalhos = new Headers({ host: 'passem-a-respeitar.test' });

vi.mock('@/lib/supabase/servidor', () => ({ clienteDeAuth: async () => ({ auth: { signUp } }) }));
vi.mock('@/lib/conta/senha-servidor', () => ({ senhaVazada: (s: string) => senhaVazada(s) }));
vi.mock('next/headers', () => ({ headers: async () => cabecalhos }));
vi.mock('next/navigation', () => ({
  redirect: (d: string) => {
    throw new Error(`redirect:${d}`);
  },
}));

const { criarConta } = await import('./acoes');
const { criarContaInicial } = await import('./estado');

let n = 0;
const email = () => `pessoa${n++}@exemplo.invalid`;

function formulario(campos: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.set(k, v);
  return f;
}

const bom = (extra: Record<string, string> = {}) =>
  formulario({
    nome: 'Fulana',
    email: email(),
    senha: 'uma senha razoavel',
    confirmacao: 'uma senha razoavel',
    aceite: 'on',
    ...extra,
  });

beforeEach(() => {
  vi.clearAllMocks();
  signUp.mockResolvedValue({ data: { session: null }, error: null });
  senhaVazada.mockResolvedValue(false);
  // IP novo por teste: o limite por IP guarda estado no modulo.
  cabecalhos = new Headers({
    host: 'passem-a-respeitar.test',
    'x-forwarded-for': `203.0.113.${(n % 200) + 1}`,
  });
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('cadastro que da certo', () => {
  it('chama o signUp com nome e aceite carimbado pelo servidor, e devolve o e-mail', async () => {
    const f = bom();
    const antes = Date.now();
    const r = await criarConta(criarContaInicial, f);

    expect(r.enviadoPara).toBe(f.get('email'));
    expect(r.erro).toBeNull();

    const chamada = signUp.mock.calls[0][0] as {
      email: string;
      password: string;
      options: { data: { nome: string; termos_aceitos_em: string }; emailRedirectTo: string };
    };
    expect(chamada.email).toBe(f.get('email'));
    expect(chamada.options.data.nome).toBe('Fulana');
    expect(Date.parse(chamada.options.data.termos_aceitos_em)).toBeGreaterThanOrEqual(antes - 1000);
  });

  it('o link de volta aponta para o callback do proprio host', async () => {
    await criarConta(criarContaInicial, bom());
    const { options } = signUp.mock.calls[0][0] as { options: { emailRedirectTo: string } };

    expect(options.emailRedirectTo).toBe(
      'https://passem-a-respeitar.test/auth/callback?next=%2Fconta'
    );
  });

  // O cliente nao escolhe a hora do aceite: um campo `termos_aceitos_em` no
  // formulario e ignorado.
  it('ignora hora de aceite vinda do formulario', async () => {
    await criarConta(criarContaInicial, bom({ termos_aceitos_em: '1999-01-01T00:00:00Z' }));
    const { options } = signUp.mock.calls[0][0] as {
      options: { data: { termos_aceitos_em: string } };
    };
    expect(options.data.termos_aceitos_em.startsWith('1999')).toBe(false);
  });

  it('com confirmacao desligada no projeto, entra direto', async () => {
    signUp.mockResolvedValue({ data: { session: { access_token: 't' } }, error: null });
    await expect(criarConta(criarContaInicial, bom())).rejects.toThrow('redirect:/conta');
  });
});

describe('mensagem generica', () => {
  // O Supabase devolve um usuario de mentira para e-mail repetido, sem erro.
  // A resposta da acao tem que ser IDENTICA a de conta nova.
  it('e-mail que ja existe recebe a mesma resposta de conta nova', async () => {
    const novo = await criarConta(criarContaInicial, bom({ email: 'novo@exemplo.invalid' }));
    const repetido = await criarConta(
      criarContaInicial,
      bom({ email: 'repetido@exemplo.invalid' })
    );

    expect(novo.erro).toBe(repetido.erro);
    expect(Boolean(novo.enviadoPara)).toBe(Boolean(repetido.enviadoPara));
  });

  it('erro de rede vira mensagem generica, sem detalhe do Supabase', async () => {
    signUp.mockResolvedValue({
      data: { session: null },
      error: { message: 'User already registered' },
    });
    const r = await criarConta(criarContaInicial, bom());

    expect(r.erro).toMatch(/não consegui/i);
    expect(r.erro).not.toMatch(/registered|existe/i);
  });
});

describe('recusas', () => {
  it('sem aceite nao cria e aponta o campo', async () => {
    const f = bom();
    f.delete('aceite');
    const r = await criarConta(criarContaInicial, f);

    expect(r.campo).toBe('aceite');
    expect(signUp).not.toHaveBeenCalled();
  });

  it.each([
    ['nome', { nome: 'A' }],
    ['email', { email: 'nao-e' }],
    ['senha', { senha: 'curta', confirmacao: 'curta' }],
    ['confirmacao', { confirmacao: 'outra' }],
  ])('aponta %s', async (esperado, campos) => {
    const r = await criarConta(criarContaInicial, bom(campos));
    expect(r.campo).toBe(esperado);
    expect(signUp).not.toHaveBeenCalled();
  });

  it('senha vazada nao cria', async () => {
    senhaVazada.mockResolvedValue(true);
    const r = await criarConta(criarContaInicial, bom());

    expect(r.campo).toBe('senha');
    expect(r.erro).toMatch(/vazamentos/i);
    expect(signUp).not.toHaveBeenCalled();
  });

  it('para depois de cinco cadastros do mesmo IP na hora', async () => {
    cabecalhos = new Headers({ host: 'h', 'x-forwarded-for': '198.51.100.250' });
    for (let i = 0; i < 5; i++) await criarConta(criarContaInicial, bom());
    const r = await criarConta(criarContaInicial, bom());

    expect(r.erro).toMatch(/muitas tentativas/i);
  });

  it('para depois de tres pedidos para o mesmo e-mail', async () => {
    const alvo = 'mesma@exemplo.invalid';
    for (let i = 0; i < 3; i++) {
      cabecalhos = new Headers({ host: 'h', 'x-forwarded-for': `198.51.100.${10 + i}` });
      await criarConta(criarContaInicial, bom({ email: alvo }));
    }
    cabecalhos = new Headers({ host: 'h', 'x-forwarded-for': '198.51.100.99' });
    const r = await criarConta(criarContaInicial, bom({ email: alvo }));

    expect(r.erro).toMatch(/muitas tentativas/i);
  });
});
