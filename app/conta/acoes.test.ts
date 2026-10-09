import { beforeEach, describe, expect, it, vi } from 'vitest';
import { codigoInicial, reenvioInicial } from '@/app/_ui/estado-do-codigo';
import {
  confirmarCodigoDaConta,
  reenviarVerificacao,
  sair,
  sairDeTodos,
  salvarNome,
} from './acoes';
import { nomeInicial } from './estado';

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
let cabecalhos = new Headers();
vi.mock('next/headers', () => ({
  cookies: async () => ({ delete: cookieDelete }),
  headers: async () => cabecalhos,
}));

// O client descartavel que confere o codigo fica de fora: o que se prova aqui
// e com qual e-mail ele e chamado, e o que a acao faz com a resposta.
const codigoDaContaConfere = vi.fn(async (_email: string, _codigo: string) => true);
vi.mock('@/lib/conta/codigo', async (original) => ({
  ...(await original<typeof import('@/lib/conta/codigo')>()),
  codigoDaContaConfere: (email: string, codigo: string) => codigoDaContaConfere(email, codigo),
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
  codigoDaContaConfere.mockResolvedValue(true);
  usuario = usuarioBase();
  // IP novo por teste: o limite por IP guarda estado no modulo.
  cabecalhos = new Headers({ 'x-forwarded-for': `198.51.100.${n % 250}` });
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
  it('reenvia para o e-mail da sessao e comeca a contagem da tela', async () => {
    const r = await reenviarVerificacao(reenvioInicial, new FormData());

    expect(resend).toHaveBeenCalledWith({ type: 'signup', email: usuario?.email });
    expect(r.erro).toBeNull();
    expect(r.aviso).toMatch(/Enviei um código/);
    expect(r.reenviadoEm).toBeGreaterThan(0);
  });

  // O e-mail vem da sessao, nunca do formulario. Aceitar um e-mail de fora
  // aqui transformaria o site em mandador de e-mail para qualquer endereco.
  it('ignora e-mail vindo do formulario', async () => {
    await reenviarVerificacao(reenvioInicial, form({ email: 'vitima@outro.invalid' }));
    expect(resend).toHaveBeenCalledWith({ type: 'signup', email: usuario?.email });
  });

  // Outra aba confirmou: a tela estava velha, e redesenhar tira o aviso.
  it('nao manda nada para quem ja esta verificado, e redesenha a conta', async () => {
    usuario = { ...usuarioBase(), email_confirmed_at: '2026-09-01T00:00:00Z' };
    const r = await reenviarVerificacao(reenvioInicial, new FormData());

    expect(resend).not.toHaveBeenCalled();
    expect(r.erro).toBeNull();
    expect(r.aviso).toMatch(/já está verificado/);
    expect(revalidatePath).toHaveBeenCalledWith('/conta');
  });

  it('recusa sem sessao', async () => {
    usuario = null;
    const r = await reenviarVerificacao(reenvioInicial, new FormData());

    expect(resend).not.toHaveBeenCalled();
    expect(r.erro).toMatch(/sessão expirou/);
    expect(r.aviso).toBeNull();
  });

  // O limite aqui protege a reputacao do dominio: caixa que recebe dez
  // e-mails iguais marca como spam, e isso atinge todo mundo.
  it('para no quarto pedido da mesma hora', async () => {
    for (let i = 0; i < 3; i++) {
      const r = await reenviarVerificacao(reenvioInicial, new FormData());
      expect(r.erro).toBeNull();
    }

    const quarto = await reenviarVerificacao(reenvioInicial, new FormData());
    expect(quarto.erro).toMatch(/Já enviei alguns/);
    expect(resend).toHaveBeenCalledTimes(3);
  });

  it('o limite de um usuario nao atinge outro', async () => {
    for (let i = 0; i < 4; i++) await reenviarVerificacao(reenvioInicial, new FormData());

    usuario = usuarioBase();
    const outro = await reenviarVerificacao(reenvioInicial, new FormData());
    expect(outro.erro).toBeNull();
  });

  // Um erro nao reinicia a contagem: o e-mail nao saiu.
  it('avisa sem repassar a mensagem do Supabase, e sem recomecar a contagem', async () => {
    resend.mockResolvedValue({ error: { message: 'over_email_send_rate_limit' } });
    const r = await reenviarVerificacao({ ...reenvioInicial, reenviadoEm: 123 }, new FormData());

    expect(r.erro).toMatch(/Não consegui enviar/);
    expect(r.erro).not.toMatch(/rate_limit/);
    expect(r.reenviadoEm).toBe(123);
  });
});

/**
 * O codigo digitado no aviso de /conta (#260). Hoje o aviso nao aparece —
 * todo caminho que cria sessao confirma o e-mail —, mas se aparecer, o campo
 * funciona e nao abre porta nova.
 */
describe('confirmarCodigoDaConta', () => {
  it('confere com o e-mail da SESSAO, nunca com o do formulario', async () => {
    await confirmarCodigoDaConta(
      codigoInicial,
      form({ codigo: '12345678', email: 'vitima@outro.invalid' })
    );

    expect(codigoDaContaConfere).toHaveBeenCalledWith('pessoa@exemplo.invalid', '12345678');
  });

  // Sem redirect: a pessoa ja esta na conta. Redesenhar tira o aviso e poe o
  // selo de verificado; o checkout le a confirmacao do Supabase a cada pedido.
  it('codigo certo redesenha a conta, sem erro e sem sair da pagina', async () => {
    const r = await confirmarCodigoDaConta(codigoInicial, form({ codigo: '1234 5678' }));

    expect(r).toEqual({ erro: null, tentativa: 1 });
    expect(codigoDaContaConfere).toHaveBeenCalledWith('pessoa@exemplo.invalid', '12345678');
    expect(revalidatePath).toHaveBeenCalledWith('/conta');
  });

  it('codigo errado: a frase de sempre, e nada redesenhado', async () => {
    codigoDaContaConfere.mockResolvedValue(false);
    const r = await confirmarCodigoDaConta(codigoInicial, form({ codigo: '00000000' }));

    expect(r.erro).toMatch(/inválido ou vencido/);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('sem sessao, nada e conferido', async () => {
    usuario = null;
    const r = await confirmarCodigoDaConta(codigoInicial, form({ codigo: '12345678' }));

    expect(r.erro).toMatch(/sessão expirou/);
    expect(codigoDaContaConfere).not.toHaveBeenCalled();
  });

  it('ja verificado (outra aba): redesenha sem gastar o codigo', async () => {
    usuario = { ...usuarioBase(), email_confirmed_at: '2026-09-01T00:00:00Z' };
    const r = await confirmarCodigoDaConta(codigoInicial, form({ codigo: '12345678' }));

    expect(r.erro).toBeNull();
    expect(codigoDaContaConfere).not.toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith('/conta');
  });

  it('menos de oito digitos nao chega ao Supabase', async () => {
    const r = await confirmarCodigoDaConta(codigoInicial, form({ codigo: '1234567' }));

    expect(r.erro).toMatch(/8 dígitos/);
    expect(codigoDaContaConfere).not.toHaveBeenCalled();
  });

  it('isca preenchida e recusada antes de tudo', async () => {
    const r = await confirmarCodigoDaConta(
      codigoInicial,
      form({ codigo: '12345678', website: 'http://spam' })
    );

    expect(r.erro).toMatch(/robô/);
    expect(codigoDaContaConfere).not.toHaveBeenCalled();
  });

  // O alvo e a conta: trocar de IP a cada chute nao ganha tentativa nova.
  it('para no decimo primeiro chute da mesma conta, mesmo trocando de IP', async () => {
    codigoDaContaConfere.mockResolvedValue(false);
    const alvo = usuarioBase();
    for (let i = 0; i < 10; i++) {
      usuario = alvo;
      cabecalhos = new Headers({ 'x-forwarded-for': `192.0.2.${i + 1}` });
      await confirmarCodigoDaConta(codigoInicial, form({ codigo: '00000000' }));
    }
    cabecalhos = new Headers({ 'x-forwarded-for': '192.0.2.200' });
    const r = await confirmarCodigoDaConta(codigoInicial, form({ codigo: '00000000' }));

    expect(r.erro).toMatch(/Muitas tentativas/);
    expect(codigoDaContaConfere).toHaveBeenCalledTimes(10);
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
