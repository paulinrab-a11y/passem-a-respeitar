import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reenviarVerificacao, sair, sairDeTodos, salvarNome } from './acoes';
import { nomeInicial, verificacaoInicial } from './estado';

let n = 0;
const usuarioBase = () => ({
  id: `11111111-2222-3333-4444-${String(n++).padStart(12, '0')}`,
  email: 'pessoa@exemplo.invalid',
  email_confirmed_at: null as string | null,
});

let usuario: ReturnType<typeof usuarioBase> | null = null;

const update = vi.fn(() => ({ eq: eqDoUpdate }));
const eqDoUpdate = vi.fn(async () => ({ error: null as { message: string } | null }));
const resend = vi.fn(async (_: { type: string; email: string }) => ({
  error: null as { message: string } | null,
}));
const signOut = vi.fn(async (_?: { scope: 'local' | 'global' }) => ({ error: null }));
const cookieDelete = vi.fn();

/** `redirect` funciona lancando; o duble imita para o teste ver o destino. */
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
vi.mock('next/headers', () => ({
  cookies: async () => ({ delete: cookieDelete }),
}));

vi.mock('@/lib/supabase/servidor', () => ({
  usuarioDaSessao: async () => usuario,
  clienteServidor: async () => ({
    from: () => ({ update }),
    auth: { resend },
  }),
  clienteDeAuth: async () => ({ auth: { signOut } }),
}));

const revalidatePath = vi.fn();
vi.mock('next/cache', () => ({ revalidatePath: (p: string) => revalidatePath(p) }));

function form(campos: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.append(k, v);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  eqDoUpdate.mockResolvedValue({ error: null });
  resend.mockResolvedValue({ error: null });
  usuario = usuarioBase();
});

describe('salvarNome', () => {
  it('salva e confirma', async () => {
    const r = await salvarNome(nomeInicial, form({ nome: 'Santxx' }));

    expect(r.recado).toEqual({ tom: 'ok', texto: 'Nome salvo.' });
    expect(update).toHaveBeenCalledWith({ nome: 'Santxx' });
  });

  it('corta espaco em volta', async () => {
    await salvarNome(nomeInicial, form({ nome: '  Santxx  ' }));
    expect(update).toHaveBeenCalledWith({ nome: 'Santxx' });
  });

  // Whitelist: o update leva um campo e um so. Campo a mais no POST nao pode
  // virar coluna escrita.
  it('ignora campo que nao pedimos', async () => {
    await salvarNome(nomeInicial, form({ nome: 'Santxx', id: 'outro', foto_caminho: 'x/y.webp' }));

    expect(update).toHaveBeenCalledWith({ nome: 'Santxx' });
    expect(update).toHaveBeenCalledOnce();
  });

  it('filtra pelo id da sessao', async () => {
    await salvarNome(nomeInicial, form({ nome: 'Santxx' }));
    expect(eqDoUpdate).toHaveBeenCalledWith('id', usuario?.id);
  });

  it('recusa sem sessao', async () => {
    usuario = null;
    const r = await salvarNome(nomeInicial, form({ nome: 'Santxx' }));

    expect(r.recado?.tom).toBe('erro');
    expect(update).not.toHaveBeenCalled();
  });

  it.each([
    ['curto demais', 'a'],
    ['vazio', ''],
    ['so espaco', '    '],
    ['longo demais', 'a'.repeat(81)],
  ])('recusa nome %s', async (_nome, valor) => {
    const r = await salvarNome(nomeInicial, form({ nome: valor }));

    expect(r.recado?.tom).toBe('erro');
    expect(update).not.toHaveBeenCalled();
  });

  it('avisa quando o banco recusa', async () => {
    eqDoUpdate.mockResolvedValue({ error: { message: 'falhou' } });
    const r = await salvarNome(nomeInicial, form({ nome: 'Santxx' }));

    expect(r.recado?.tom).toBe('erro');
    // A mensagem do banco nao chega ao usuario.
    expect(r.recado?.texto).not.toMatch(/falhou/);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  // Sem isso o nome antigo continuaria na tela ate a proxima navegacao dura.
  it('revalida a pagina depois de salvar', async () => {
    await salvarNome(nomeInicial, form({ nome: 'Santxx' }));
    expect(revalidatePath).toHaveBeenCalledWith('/conta');
  });

  it('conta as tentativas', async () => {
    const a = await salvarNome(nomeInicial, form({ nome: 'Santxx' }));
    const b = await salvarNome(a, form({ nome: 'Santxx' }));
    expect(b.tentativa).toBe(a.tentativa + 1);
  });
});

describe('reenviarVerificacao', () => {
  it('reenvia para o e-mail da sessao', async () => {
    const r = await reenviarVerificacao(verificacaoInicial, new FormData());

    expect(resend).toHaveBeenCalledWith({ type: 'signup', email: usuario?.email });
    expect(r.recado?.tom).toBe('ok');
  });

  // O e-mail vem da sessao, nunca do formulario. Aceitar um e-mail de fora
  // aqui transformaria o site em mandador de e-mail para qualquer endereco.
  it('ignora e-mail vindo do formulario', async () => {
    await reenviarVerificacao(verificacaoInicial, form({ email: 'vitima@outro.invalid' }));
    expect(resend).toHaveBeenCalledWith({ type: 'signup', email: usuario?.email });
  });

  it('nao manda nada para quem ja esta verificado', async () => {
    usuario = { ...usuarioBase(), email_confirmed_at: '2026-09-01T00:00:00Z' };
    const r = await reenviarVerificacao(verificacaoInicial, new FormData());

    expect(resend).not.toHaveBeenCalled();
    expect(r.recado?.tom).toBe('ok');
  });

  it('recusa sem sessao', async () => {
    usuario = null;
    const r = await reenviarVerificacao(verificacaoInicial, new FormData());

    expect(resend).not.toHaveBeenCalled();
    expect(r.recado?.tom).toBe('erro');
  });

  // O limite aqui protege a reputacao do dominio: caixa que recebe dez
  // e-mails iguais marca como spam, e isso atinge todo mundo.
  it('para no quarto pedido da mesma hora', async () => {
    for (let i = 0; i < 3; i++) {
      const r = await reenviarVerificacao(verificacaoInicial, new FormData());
      expect(r.recado?.tom).toBe('ok');
    }

    const quarto = await reenviarVerificacao(verificacaoInicial, new FormData());
    expect(quarto.recado?.tom).toBe('erro');
    expect(resend).toHaveBeenCalledTimes(3);
  });

  it('o limite de um usuario nao atinge outro', async () => {
    for (let i = 0; i < 4; i++) await reenviarVerificacao(verificacaoInicial, new FormData());

    usuario = usuarioBase();
    const outro = await reenviarVerificacao(verificacaoInicial, new FormData());
    expect(outro.recado?.tom).toBe('ok');
  });

  it('avisa sem repassar a mensagem do Supabase', async () => {
    resend.mockResolvedValue({ error: { message: 'over_email_send_rate_limit' } });
    const r = await reenviarVerificacao(verificacaoInicial, new FormData());

    expect(r.recado?.tom).toBe('erro');
    expect(r.recado?.texto).not.toMatch(/rate_limit/);
  });
});

describe('sair', () => {
  it('encerra so esta sessao e manda para a home', async () => {
    await expect(sair()).rejects.toThrow('redirect:/');
    expect(signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  // O que separa "sair" de "limpar o navegador": o refresh token e revogado no
  // servidor. Sem isso, quem tivesse copiado o token continuaria entrando.
  it('sair de todos usa escopo global', async () => {
    await expect(sairDeTodos()).rejects.toThrow('redirect:/');
    expect(signOut).toHaveBeenCalledWith({ scope: 'global' });
  });

  // O par_lembrar e nosso, nao do Supabase. Deixar para tras faria a proxima
  // sessao herdar a escolha de quem usou o navegador antes.
  it('apaga tambem o cookie de manter conectado', async () => {
    await expect(sair()).rejects.toThrow();
    expect(cookieDelete).toHaveBeenCalledWith('par_lembrar');
  });

  it('revoga antes de redirecionar', async () => {
    await expect(sair()).rejects.toThrow();
    expect(signOut).toHaveBeenCalled();
  });
});
