import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Entrar sem senha, com codigo no e-mail (#387). O que estas acoes nunca
 * fazem: dizer se o e-mail tem conta, mandar codigo sem aceite, gravar sessao
 * antes de a conta ficar sem a senha de outra pessoa, ou mandar a pessoa para
 * fora do site depois de entrar.
 *
 * A protecao contra bot e as cotas antes e depois do desafio estao em
 * app/contra-robo.test.ts, com os outros formularios publicos.
 */
type Entrada =
  | { resultado: 'invalido' }
  | { resultado: 'recuperar' }
  | { resultado: 'pronto'; sessao: { access_token: string; refresh_token: string } };

// Inventada: nenhum token de verdade entra num teste.
const SESSAO = { access_token: 'acesso', refresh_token: 'renovacao' };

let ordem: string[] = [];
const mandaCodigoDeEntrada = vi.fn(async (_email: string) => true);
const entraPorCodigo = vi.fn(async (_email: string, _codigo: string): Promise<Entrada> => {
  ordem.push('entraPorCodigo');
  return { resultado: 'pronto', sessao: SESSAO };
});
const setSession = vi.fn(async (_s: unknown) => {
  ordem.push('setSession');
  return { error: null as { message: string } | null };
});
const clienteDeAuth = vi.fn(async (_lembrar: boolean) => ({ auth: { setSession } }));
const jarSet = vi.fn((nome: string, valor: string, ..._r: unknown[]) => {
  ordem.push(`cookie:${nome}=${valor}`);
});
const jarDelete = vi.fn((nome: string) => {
  ordem.push(`apaga:${nome}`);
});
let cabecalhos = new Headers();

vi.mock('@/lib/conta/codigo', async (original) => ({
  ...(await original<typeof import('@/lib/conta/codigo')>()),
  mandaCodigoDeEntrada: (email: string) => mandaCodigoDeEntrada(email),
  entraPorCodigo: (email: string, codigo: string) => entraPorCodigo(email, codigo),
}));
vi.mock('@/lib/supabase/servidor', () => ({
  clienteDeAuth: (lembrar: boolean) => clienteDeAuth(lembrar),
  cabecalhosDeOrigem: async () => ({}),
}));
vi.mock('next/headers', () => ({
  headers: async () => cabecalhos,
  cookies: async () => ({ set: jarSet, delete: jarDelete }),
}));
vi.mock('next/navigation', () => ({
  redirect: (destino: string) => {
    throw new Error(`redirect:${destino}`);
  },
}));

const { pedirCodigo, reenviarCodigoDeEntrada, entrarComCodigo } = await import('./acoes-codigo');
const { pedirCodigoInicial } = await import('./estado');
const { codigoInicial, reenvioInicial } = await import('@/app/_ui/estado-do-codigo');
const { CODIGO_INVALIDO, CODIGO_INCOMPLETO } = await import('@/lib/conta/codigo');

let n = 0;
const email = () => `pessoa${n}@exemplo.invalid`;

function formulario(campos: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.set(k, v);
  return f;
}

/** Roda a acao e devolve para onde ela redirecionou, ou o estado. */
async function destino<T>(p: Promise<T>) {
  try {
    return { estado: await p, para: null };
  } catch (e) {
    const m = /^Error: redirect:(.*)$/.exec(String(e));
    if (!m) throw e;
    return { estado: null, para: m[1] };
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  ordem = [];
  n += 1;
  // IP novo por teste: os limites guardam estado no modulo.
  cabecalhos = new Headers({
    host: 'passem-a-respeitar.test',
    'x-forwarded-for': `198.51.100.${(n % 250) + 1}`,
  });
  vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
  vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('pedirCodigo', () => {
  it('com aceite: manda o codigo e abre a tela do codigo com o e-mail normalizado', async () => {
    const r = await pedirCodigo(
      pedirCodigoInicial,
      formulario({ email: `  ${email().toUpperCase()} `, aceite: 'on', lembrar: 'on' })
    );

    expect(r).toEqual({
      erro: null,
      campo: null,
      tentativa: 1,
      enviado: { email: email(), lembrar: true },
    });
    expect(mandaCodigoDeEntrada).toHaveBeenCalledWith(email());
  });

  it('sem aceite: recusa apontando a caixa, e nada sai', async () => {
    const r = await pedirCodigo(pedirCodigoInicial, formulario({ email: email() }));

    expect(r).toMatchObject({ campo: 'aceite' });
    expect(r.enviado).toBeUndefined();
    expect(r.erro).toMatch(/aceitar a política de privacidade/);
    expect(mandaCodigoDeEntrada).not.toHaveBeenCalled();
  });

  it('e-mail malformado: recusa apontando o campo, e nada sai', async () => {
    const r = await pedirCodigo(
      pedirCodigoInicial,
      formulario({ email: 'nao-e-email', aceite: 'on' })
    );

    expect(r).toMatchObject({ campo: 'email', erro: 'Confira o e-mail.' });
    expect(mandaCodigoDeEntrada).not.toHaveBeenCalled();
  });

  // O Supabase recusando (intervalo minimo, por exemplo) nao muda a resposta:
  // repassar contaria que aquela caixa acabou de receber um codigo.
  it('a resposta e a mesma quando o Supabase recusa o envio', async () => {
    mandaCodigoDeEntrada.mockResolvedValueOnce(false);
    const recusado = await pedirCodigo(
      pedirCodigoInicial,
      formulario({ email: email(), aceite: 'on' })
    );
    const aceito = await pedirCodigo(
      pedirCodigoInicial,
      formulario({ email: `outra${n}@exemplo.invalid`, aceite: 'on' })
    );

    expect(recusado.erro).toBeNull();
    expect(recusado.enviado).toEqual({ email: email(), lembrar: false });
    expect(Object.keys(recusado)).toEqual(Object.keys(aceito));
  });

  it('o piso de tempo vale tambem para o envio recusado', async () => {
    vi.stubEnv('CONTA_PISO_MS', '80');
    mandaCodigoDeEntrada.mockResolvedValueOnce(false);

    const inicio = performance.now();
    await pedirCodigo(pedirCodigoInicial, formulario({ email: email(), aceite: 'on' }));

    expect(performance.now() - inicio).toBeGreaterThanOrEqual(75);
  });

  it('tres pedidos por caixa na hora: o quarto nao sai', async () => {
    const alvo = email();
    for (let i = 0; i < 3; i++) {
      cabecalhos = new Headers({ 'x-forwarded-for': `192.0.2.${n % 50}${i}` });
      const r = await pedirCodigo(pedirCodigoInicial, formulario({ email: alvo, aceite: 'on' }));
      expect(r.erro).toBeNull();
    }
    cabecalhos = new Headers({ 'x-forwarded-for': `192.0.2.${n % 50}9` });
    const r = await pedirCodigo(pedirCodigoInicial, formulario({ email: alvo, aceite: 'on' }));

    expect(r.erro).toBe('Muitos pedidos. Tente de novo mais tarde.');
    expect(mandaCodigoDeEntrada).toHaveBeenCalledTimes(3);
  });
});

describe('reenviarCodigoDeEntrada', () => {
  it('manda outro codigo, com o recado de sempre', async () => {
    const r = await reenviarCodigoDeEntrada(
      reenvioInicial,
      formulario({ email: email(), aceite: 'on' })
    );

    expect(r.erro).toBeNull();
    expect(r.aviso).toMatch(/Se o e-mail for válido/);
    expect(mandaCodigoDeEntrada).toHaveBeenCalledWith(email());
  });

  // O reenvio tambem pode criar a conta: sem aceite, nao manda nada.
  it('sem o aceite, nada sai', async () => {
    const r = await reenviarCodigoDeEntrada(reenvioInicial, formulario({ email: email() }));

    expect(r.erro).not.toBeNull();
    expect(mandaCodigoDeEntrada).not.toHaveBeenCalled();
  });
});

describe('entrarComCodigo', () => {
  const certo = (extra: Record<string, string> = {}) =>
    formulario({
      email: email(),
      codigo: '1234 5678',
      next: '/checkout?p=camiseta&tam=M',
      ...extra,
    });

  it('codigo certo: sessao no cookie, depois a escolha, e volta para o checkout', async () => {
    const { para } = await destino(entrarComCodigo(codigoInicial, certo({ lembrar: '1' })));

    expect(para).toBe('/checkout?p=camiseta&tam=M');
    expect(entraPorCodigo).toHaveBeenCalledWith(email(), '12345678');
    expect(clienteDeAuth).toHaveBeenCalledWith(true);
    expect(setSession).toHaveBeenCalledWith(SESSAO);
    expect(ordem).toEqual([
      'entraPorCodigo',
      'setSession',
      'cookie:par_lembrar=1',
      'apaga:par_recuperacao',
    ]);
  });

  it('sem "manter conectado", a sessao nasce curta', async () => {
    await destino(entrarComCodigo(codigoInicial, certo()));

    expect(clienteDeAuth).toHaveBeenCalledWith(false);
    expect(ordem).toContain('cookie:par_lembrar=0');
  });

  it.each([
    ['site de fora', 'https://exemplo.invalid/conta'],
    ['protocolo relativo', '//exemplo.invalid'],
  ])('destino de %s: volta para a conta', async (_, next) => {
    const { para } = await destino(entrarComCodigo(codigoInicial, certo({ next })));
    expect(para).toBe('/conta');
  });

  it('codigo errado: a frase de sempre, e nenhuma sessao', async () => {
    entraPorCodigo.mockResolvedValueOnce({ resultado: 'invalido' });

    const { estado } = await destino(entrarComCodigo(codigoInicial, certo()));

    expect(estado).toEqual({ erro: CODIGO_INVALIDO, tentativa: 1 });
    expect(setSession).not.toHaveBeenCalled();
    expect(jarSet).not.toHaveBeenCalled();
  });

  it('codigo incompleto nem chega ao Supabase', async () => {
    const { estado } = await destino(entrarComCodigo(codigoInicial, certo({ codigo: '1234' })));

    expect(estado).toEqual({ erro: CODIGO_INCOMPLETO, tentativa: 1 });
    expect(entraPorCodigo).not.toHaveBeenCalled();
  });

  it('senha antiga que nao saiu da conta: o recado da recuperacao, sem sessao', async () => {
    entraPorCodigo.mockResolvedValueOnce({ resultado: 'recuperar' });

    const { estado } = await destino(entrarComCodigo(codigoInicial, certo()));

    expect(estado).toEqual({ erro: null, tentativa: 1, desfecho: 'recuperar' });
    expect(setSession).not.toHaveBeenCalled();
  });

  it('sessao que nao chegou ao cookie: pede um codigo novo, sem gravar a escolha', async () => {
    setSession.mockResolvedValueOnce({ error: { message: 'fetch failed' } });

    const { estado, para } = await destino(entrarComCodigo(codigoInicial, certo()));

    expect(para).toBeNull();
    expect(estado?.erro).toMatch(/Peça um código novo/);
    expect(jarSet).not.toHaveBeenCalled();
  });

  it('isca preenchida: recusa sem conferir nada', async () => {
    const { estado } = await destino(
      entrarComCodigo(codigoInicial, certo({ website: 'https://spam.invalid' }))
    );

    expect(estado?.erro).toMatch(/robô/);
    expect(entraPorCodigo).not.toHaveBeenCalled();
  });

  it('dez chutes por e-mail em dez minutos: o decimo primeiro nem chega ao Supabase', async () => {
    entraPorCodigo.mockResolvedValue({ resultado: 'invalido' });
    const alvo = email();
    for (let i = 0; i < 10; i++) {
      cabecalhos = new Headers({ 'x-forwarded-for': `192.0.2.${100 + (n % 50)}${i}` });
      await destino(entrarComCodigo(codigoInicial, certo({ email: alvo })));
    }
    cabecalhos = new Headers({ 'x-forwarded-for': '192.0.2.99' });
    const { estado } = await destino(entrarComCodigo(codigoInicial, certo({ email: alvo })));

    expect(estado?.erro).toMatch(/Muitas tentativas/);
    expect(entraPorCodigo).toHaveBeenCalledTimes(10);
    entraPorCodigo.mockReset();
  });
});
