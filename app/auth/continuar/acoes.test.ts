import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * O POST do botao "Continuar" (#348) e o unico lugar onde um `token_hash`
 * vira sessao. O que se prova: so tipo e hash validos chegam ao Supabase; a
 * recuperacao vai sempre para a redefinicao com a marca presa a conta; o
 * resto vai para um destino seguro; e falha nao deixa marca nem diz o motivo.
 */
const CONTA = '11111111-1111-4111-8111-111111111111';
const HASH = '0123456789abcdef0123456789abcdef0123456789abcdef01234567';

const verifyOtp = vi.fn(async (_o: unknown) => ({
  data: { user: { id: CONTA } as { id: string } | null },
  error: null as { message: string } | null,
}));

const gravados = new Map<string, string>();
const apagados: string[] = [];

vi.mock('@/lib/supabase/servidor', () => ({
  clienteDeAuth: async () => ({ auth: { verifyOtp } }),
}));
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'x-forwarded-for': '203.0.113.9' }),
  cookies: async () => ({
    set: (nome: string, valor: string) => gravados.set(nome, valor),
    delete: (nome: string) => apagados.push(nome),
  }),
}));
vi.mock('next/navigation', () => ({
  redirect: (d: string) => {
    throw new Error(`redirect:${d}`);
  },
}));

const { continuarLink } = await import('./acoes');
const { marcaDeRecuperacaoConfere } = await import('@/lib/conta/recuperacao');

function envia(campos: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.set(k, v);
  return continuarLink(f);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('CONVITE_COOKIE_SECRET', 'sb_secret_de_teste');
  gravados.clear();
  apagados.length = 0;
  verifyOtp.mockResolvedValue({ data: { user: { id: CONTA } }, error: null });
});

describe('recuperacao', () => {
  it('verifica o hash, grava a marca desta conta e vai para a redefinicao', async () => {
    await expect(envia({ token_hash: HASH, type: 'recovery' })).rejects.toThrow(
      'redirect:/redefinir-senha'
    );

    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: HASH, type: 'recovery' });
    expect(marcaDeRecuperacaoConfere(gravados.get('par_recuperacao'), CONTA)).toBe(true);
    expect(gravados.get('par_lembrar')).toBe('0');
  });

  it('o next do formulario nao escolhe o destino da recuperacao', async () => {
    await expect(envia({ token_hash: HASH, type: 'recovery', next: '/checkout' })).rejects.toThrow(
      'redirect:/redefinir-senha'
    );
  });

  it('link recusado volta ao pedido, sem marca e sem o hash no log', async () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {});
    verifyOtp.mockResolvedValue({ data: { user: null }, error: { message: 'expired' } });

    await expect(envia({ token_hash: HASH, type: 'recovery' })).rejects.toThrow(
      'redirect:/recuperar-senha?erro=link'
    );
    expect(gravados.has('par_recuperacao')).toBe(false);
    expect(String(aviso.mock.calls[0]?.[0])).not.toContain(HASH);
    aviso.mockRestore();
  });
});

describe('outros links', () => {
  it('confirmacao de cadastro vai para o next seguro e apaga marca antiga', async () => {
    await expect(
      envia({ token_hash: HASH, type: 'signup', next: '/conta/pedidos' })
    ).rejects.toThrow('redirect:/conta/pedidos');

    expect(gravados.has('par_recuperacao')).toBe(false);
    expect(apagados).toContain('par_recuperacao');
  });

  it('next de fora do site vira a conta', async () => {
    await expect(
      envia({ token_hash: HASH, type: 'signup', next: 'https://mau.test' })
    ).rejects.toThrow('redirect:/conta');
  });
});

describe('entrada torta', () => {
  it.each([
    [{ token_hash: HASH, type: 'coisa' }, '/entrar?erro=link'],
    [{ token_hash: 'curto', type: 'recovery' }, '/recuperar-senha?erro=link'],
    [{ token_hash: '<script>alert(1)</script>xxxxxxxx', type: 'signup' }, '/entrar?erro=link'],
    [{ type: 'recovery' }, '/recuperar-senha?erro=link'],
  ])('%o nao chega ao Supabase', async (campos, volta) => {
    await expect(envia(campos)).rejects.toThrow(`redirect:${volta}`);
    expect(verifyOtp).not.toHaveBeenCalled();
  });
});
