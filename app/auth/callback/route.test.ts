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

let logado: { id: string } | null = null;

vi.mock('@/lib/supabase/servidor', () => ({
  clienteDeAuth: async () => ({ auth: { exchangeCodeForSession, verifyOtp } }),
  usuarioDaSessao: async () => logado,
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
  logado = null;
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

/**
 * A troca de e-mail (#36) pede confirmacao nos dois enderecos. O primeiro
 * link nao gera codigo, e o segundo costuma ser aberto em outro navegador.
 * Nenhum dos dois pode virar sessao; nenhum dos dois merece "link invalido".
 */
describe('troca de e-mail', () => {
  const PRIMEIRA = '?next=%2Fconta%2Fseguranca&message=Confirmation+link+accepted';

  it('primeira confirmacao, com sessao: vai para a seguranca sem criar sessao', async () => {
    logado = { id: 'u1' };
    const d = destino(await chega(PRIMEIRA));

    expect(d.pathname).toBe('/conta/seguranca');
    expect(d.searchParams.get('erro')).toBeNull();
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it('primeira confirmacao, sem sessao: login, sem aviso de link invalido', async () => {
    const d = destino(await chega(PRIMEIRA));

    expect(d.pathname).toBe('/entrar');
    expect(d.searchParams.get('erro')).toBeNull();
  });

  it('segunda confirmacao em outro navegador, com sessao aqui: segue para o destino', async () => {
    logado = { id: 'u1' };
    exchangeCodeForSession.mockResolvedValue({ error: { message: 'code verifier' } });
    const d = destino(await chega('?code=abc&next=%2Fconta%2Fseguranca'));

    expect(d.pathname).toBe('/conta/seguranca');
    expect(d.searchParams.get('erro')).toBeNull();
  });

  it('message forjada nao abre nada para quem nao tem sessao', async () => {
    const d = destino(await chega('?message=qualquer&next=%2Fconta%2Fadmin%2Fpedidos'));

    expect(d.pathname).toBe('/entrar');
  });

  it('message junto de error e erro, nao confirmacao', async () => {
    logado = { id: 'u1' };
    const d = destino(await chega('?message=x&error=access_denied&error_code=otp_expired'));

    expect(d.pathname).toBe('/entrar');
    expect(d.searchParams.get('erro')).toBe('link');
  });

  it('message nao leva para fora do site', async () => {
    logado = { id: 'u1' };
    const d = destino(await chega('?message=x&next=https%3A%2F%2Fsite-falso.test'));

    expect(d.origin).toBe(ORIGEM);
    expect(d.pathname).toBe('/conta');
  });
});
