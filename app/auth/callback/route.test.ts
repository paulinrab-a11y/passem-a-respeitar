import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * O callback e a porta por onde um link de e-mail vira sessao. O que se
 * prova: link bom vira sessao e vai para o destino; link ruim nao vira nada
 * e volta com aviso; e `next` nunca leva para fora do site.
 */
const exchangeCodeForSession = vi.fn(async (_c: string) => ({
  error: null as { message: string } | null,
}));
const verifyOtp = vi.fn(async (_o: unknown) => ({ error: null as { message: string } | null }));

vi.mock('@/lib/supabase/servidor', () => ({
  clienteDeAuth: async () => ({ auth: { exchangeCodeForSession, verifyOtp } }),
}));

const { GET } = await import('./route');

const ORIGEM = 'https://passem-a-respeitar.test';

function chega(query: string) {
  return GET(new NextRequest(`${ORIGEM}/auth/callback${query}`));
}

function destino(r: Response) {
  return new URL(r.headers.get('location') ?? '', ORIGEM);
}

beforeEach(() => {
  vi.clearAllMocks();
  exchangeCodeForSession.mockResolvedValue({ error: null });
  verifyOtp.mockResolvedValue({ error: null });
});

describe('fluxo PKCE (?code=)', () => {
  it('troca o codigo e vai para o next', async () => {
    const r = await chega('?code=abc&next=%2Fredefinir-senha');

    expect(exchangeCodeForSession).toHaveBeenCalledWith('abc');
    expect(r.status).toBe(307);
    expect(destino(r).pathname).toBe('/redefinir-senha');
  });

  it('sem next vai para a conta', async () => {
    expect(destino(await chega('?code=abc')).pathname).toBe('/conta');
  });

  it('codigo invalido volta ao login com aviso, sem sessao', async () => {
    exchangeCodeForSession.mockResolvedValue({ error: { message: 'invalid' } });
    const d = destino(await chega('?code=ruim'));

    expect(d.pathname).toBe('/entrar');
    expect(d.searchParams.get('erro')).toBe('link');
  });
});

describe('fluxo token_hash', () => {
  it('confere o hash com o tipo e vai para o next', async () => {
    const r = await chega('?token_hash=h1&type=recovery&next=%2Fredefinir-senha');

    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: 'h1', type: 'recovery' });
    expect(destino(r).pathname).toBe('/redefinir-senha');
  });

  // Uso unico e expiracao sao do Supabase; aqui so se garante que a recusa
  // dele nao vira sessao.
  it('hash usado ou vencido, na recuperacao, volta ao pedido com aviso', async () => {
    verifyOtp.mockResolvedValue({ error: { message: 'expired' } });
    const d = destino(await chega('?token_hash=velho&type=recovery'));

    expect(d.pathname).toBe('/recuperar-senha');
    expect(d.searchParams.get('erro')).toBe('link');
  });

  it('tipo desconhecido nao chama nada e volta ao login', async () => {
    const d = destino(await chega('?token_hash=h1&type=coisa'));

    expect(verifyOtp).not.toHaveBeenCalled();
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
    expect(d.pathname).toBe('/entrar');
  });
});

describe('sem nada', () => {
  it('sem code nem token_hash volta ao login', async () => {
    const d = destino(await chega(''));
    expect(d.pathname).toBe('/entrar');
    expect(d.searchParams.get('erro')).toBe('link');
  });
});

// O `next` vem do e-mail, e e-mail e texto que qualquer um forja.
describe('next nunca sai do site', () => {
  it.each(['https://site-que-imita.com', '//site-que-imita.com', '/\\site-que-imita.com'])(
    'next=%s vira /conta',
    async (next) => {
      const d = destino(await chega(`?code=abc&next=${encodeURIComponent(next)}`));
      expect(d.host).toBe('passem-a-respeitar.test');
      expect(d.pathname).toBe('/conta');
    }
  );
});
