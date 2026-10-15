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
const verifyOtp = vi.fn(async (_o: unknown) => ({ error: null as { message: string } | null }));
const resend = vi.fn(async (_o: unknown) => ({ error: null as { message: string } | null }));
let cabecalhos = new Headers({ host: 'passem-a-respeitar.test' });

type ErroDoSupabase = { message: string; code?: string } | null;

// A ordem de tudo que toca a conta ou o cookie na confirmacao do cadastro
// (#284): o client avulso, o do cookie e o cookie da escolha.
let ordem: string[] = [];
// Inventada: nenhum token de verdade entra num teste.
const SESSAO = { access_token: 'acesso', refresh_token: 'renovacao' };

/** O client que nao grava cookie, de lib/conta/codigo.ts. */
const avulso = {
  verifyOtp: vi.fn(async (_o: unknown) => {
    ordem.push('verifyOtp');
    return { data: { session: SESSAO as typeof SESSAO | null }, error: null as ErroDoSupabase };
  }),
  updateUser: vi.fn(async (_o: unknown) => {
    ordem.push('updateUser');
    return { error: null as ErroDoSupabase };
  }),
  signOut: vi.fn(async (o: { scope: string }) => {
    ordem.push(`signOut:${o.scope}`);
    return { error: null };
  }),
};
/** O client do cookie. `updateUser` so existe para provar que ninguem o chama. */
const setSession = vi.fn(async (_o: unknown) => {
  ordem.push('setSession');
  return { error: null as ErroDoSupabase };
});
const updateUser = vi.fn(async (_o: unknown) => ({ error: null }));
const clienteDeAuth = vi.fn(async (_lembrar: boolean) => ({
  auth: { signUp, verifyOtp, resend, setSession, updateUser },
}));
const jarSet = vi.fn((nome: string, ..._resto: unknown[]) => {
  ordem.push(`cookie:${nome}`);
});

vi.mock('@/lib/supabase/servidor', () => ({
  clienteDeAuth: (lembrar: boolean) => clienteDeAuth(lembrar),
  cabecalhosDeOrigem: async () => ({}),
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth: avulso }) }));
vi.mock('@/lib/conta/senha-servidor', () => ({ senhaVazada: (s: string) => senhaVazada(s) }));
vi.mock('next/headers', () => ({
  headers: async () => cabecalhos,
  cookies: async () => ({ set: jarSet }),
}));
vi.mock('next/navigation', () => ({
  redirect: (d: string) => {
    throw new Error(`redirect:${d}`);
  },
}));

const { criarConta, confirmarCadastro, confirmarCodigo, reenviarCodigo } = await import('./acoes');
const { criarContaInicial } = await import('./estado');
const { codigoInicial, reenvioInicial } = await import('@/app/_ui/estado-do-codigo');

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
  ordem = [];
  signUp.mockResolvedValue({ data: { session: null }, error: null });
  verifyOtp.mockResolvedValue({ error: null });
  resend.mockResolvedValue({ error: null });
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
  it('chama o signUp com o aceite carimbado pelo servidor, sem nome, e devolve o e-mail', async () => {
    const f = bom();
    const antes = Date.now();
    const r = await criarConta(criarContaInicial, f);

    expect(r.enviadoPara).toBe(f.get('email'));
    expect(r.erro).toBeNull();

    const chamada = signUp.mock.calls[0][0] as {
      email: string;
      password: string;
      options: { data: Record<string, string>; emailRedirectTo: string };
    };
    expect(chamada.email).toBe(f.get('email'));
    // So o aceite: nome no cadastro acabou na #207, e um `nome` injetado no
    // formulario nao chega ao perfil.
    expect(Object.keys(chamada.options.data)).toEqual(['termos_aceitos_em']);
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

/**
 * Confirmar pelo codigo (#224), na tela do login de conta nao confirmada
 * (#260): confere no servidor, entra na conta, e nunca diz se o e-mail tem
 * cadastro.
 */
describe('confirmar pelo codigo do login (#224, #260)', () => {
  const codigoBom = (extra: Record<string, string> = {}) =>
    formulario({ email: 'Maria@Exemplo.invalid', codigo: '12345678', ...extra });

  it('confere com verifyOtp do tipo email e manda para a conta', async () => {
    await expect(confirmarCodigo(codigoInicial, codigoBom())).rejects.toThrow('redirect:/conta');

    expect(verifyOtp).toHaveBeenCalledWith({
      email: 'maria@exemplo.invalid',
      token: '12345678',
      type: 'email',
    });
  });

  it('aceita o codigo com espacos e texto em volta', async () => {
    await expect(
      confirmarCodigo(codigoInicial, codigoBom({ codigo: ' 1234 5678 ' }))
    ).rejects.toThrow('redirect:/conta');

    expect(verifyOtp).toHaveBeenCalledWith(expect.objectContaining({ token: '12345678' }));
  });

  it('o next passa pelo destinoSeguro: nada de site de fora', async () => {
    await expect(
      confirmarCodigo(codigoInicial, codigoBom({ next: 'https://site-falso.test/' }))
    ).rejects.toThrow('redirect:/conta');
    await expect(
      confirmarCodigo(codigoInicial, codigoBom({ next: '/checkout?p=camiseta-cbac&tam=M' }))
    ).rejects.toThrow('redirect:/checkout?p=camiseta-cbac&tam=M');
  });

  it('codigo errado, vencido ou de e-mail sem cadastro: a mesma frase', async () => {
    verifyOtp.mockResolvedValue({ error: { message: 'Token has expired or is invalid' } });
    const r1 = await confirmarCodigo(codigoInicial, codigoBom());
    verifyOtp.mockResolvedValue({ error: { message: 'User not found' } });
    const r2 = await confirmarCodigo(codigoInicial, codigoBom());

    expect(r1.erro).toMatch(/inválido ou vencido/);
    expect(r2.erro).toBe(r1.erro);
    expect(r1.tentativa).toBe(1);
  });

  // Do cadastro nao vem "manter conectado": a sessao nasce de navegador, e
  // a escolha fica registrada como no login, para o middleware ler.
  it('sem lembrar, a sessao morre com o navegador e o par_lembrar fica 0', async () => {
    await expect(confirmarCodigo(codigoInicial, codigoBom())).rejects.toThrow('redirect:');

    expect(clienteDeAuth).toHaveBeenCalledWith(false);
    expect(jarSet).toHaveBeenCalledWith(
      'par_lembrar',
      '0',
      expect.objectContaining({ httpOnly: true, maxAge: undefined })
    );
  });

  // Do login (#260): quem marcou "manter conectado" antes do codigo continua
  // com a sessao de trinta dias depois dele.
  it('lembrar vindo do login vira sessao de trinta dias', async () => {
    await expect(confirmarCodigo(codigoInicial, codigoBom({ lembrar: '1' }))).rejects.toThrow(
      'redirect:'
    );

    expect(clienteDeAuth).toHaveBeenCalledWith(true);
    expect(jarSet).toHaveBeenCalledWith(
      'par_lembrar',
      '1',
      expect.objectContaining({ maxAge: 60 * 60 * 24 * 30 })
    );
  });

  it('qualquer outro valor de lembrar vale o lado seguro', async () => {
    await expect(confirmarCodigo(codigoInicial, codigoBom({ lembrar: 'on' }))).rejects.toThrow(
      'redirect:'
    );

    expect(clienteDeAuth).toHaveBeenCalledWith(false);
  });

  it('codigo errado nao grava a escolha: nao ha sessao', async () => {
    verifyOtp.mockResolvedValue({ error: { message: 'Token has expired or is invalid' } });
    await confirmarCodigo(codigoInicial, codigoBom({ lembrar: '1' }));

    expect(jarSet).not.toHaveBeenCalled();
  });

  it('menos de oito digitos nao chega ao Supabase', async () => {
    const r = await confirmarCodigo(codigoInicial, codigoBom({ codigo: '1234567' }));

    expect(r.erro).toMatch(/8 dígitos/);
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it('isca preenchida e recusada antes de tudo', async () => {
    const r = await confirmarCodigo(codigoInicial, codigoBom({ website: 'http://spam' }));

    expect(r.erro).toMatch(/robô/);
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it('para depois de dez tentativas no mesmo e-mail', async () => {
    verifyOtp.mockResolvedValue({ error: { message: 'invalid' } });
    const alvo = 'chute@exemplo.invalid';
    for (let i = 0; i < 10; i++) {
      cabecalhos = new Headers({ host: 'h', 'x-forwarded-for': `198.51.100.${100 + i}` });
      await confirmarCodigo(codigoInicial, codigoBom({ email: alvo }));
    }
    cabecalhos = new Headers({ host: 'h', 'x-forwarded-for': '198.51.100.199' });
    const r = await confirmarCodigo(codigoInicial, codigoBom({ email: alvo }));

    expect(r.erro).toMatch(/muitas tentativas/i);
    expect(verifyOtp).toHaveBeenCalledTimes(10);
  });

  // Quem chegou pelo login provou a senha da conta: ela ja e de quem
  // confirma. Gravar a do formulario aqui aceitaria uma senha que nao passou
  // por regra nenhuma (#284).
  it('nunca grava senha, nem com uma senha no formulario', async () => {
    const forjada = { senha: 'senha forjada longa', confirmacao: 'senha forjada longa' };
    // E-mail proprio: o limite por e-mail guarda estado entre os casos.
    await expect(
      confirmarCodigo(codigoInicial, codigoBom({ email: email(), ...forjada }))
    ).rejects.toThrow('redirect:');

    expect(verifyOtp).toHaveBeenCalledTimes(1);
    expect(updateUser).not.toHaveBeenCalled();
    expect(avulso.updateUser).not.toHaveBeenCalled();
    expect(avulso.verifyOtp).not.toHaveBeenCalled();
  });
});

/**
 * Pre-sequestro de conta (#284): alguem cadastra o e-mail de outra pessoa com
 * a senha dele e nao confirma. O Supabase nao troca a senha da conta pendente
 * no segundo cadastro; confirmar pela tela do cadastro grava a da pessoa.
 */
describe('confirmar pela tela do cadastro grava a senha escolhida (#284)', () => {
  const SENHA = 'a senha da maria';
  let alvo = '';
  const cadastro = (extra: Record<string, string> = {}) =>
    formulario({ email: alvo, codigo: '12345678', senha: SENHA, confirmacao: SENHA, ...extra });

  beforeEach(() => {
    // E-mail e IP novos por caso: os contadores de conferencia guardam estado
    // no modulo, e o limite por e-mail e de dez.
    alvo = email();
    cabecalhos = new Headers({
      host: 'passem-a-respeitar.test',
      'x-forwarded-for': `192.0.2.${(n % 250) + 1}`,
    });
  });

  it('codigo, senha, outras sessoes, e so entao a sessao vai para o cookie', async () => {
    await expect(confirmarCadastro(codigoInicial, cadastro())).rejects.toThrow('redirect:/conta');

    expect(ordem).toEqual([
      'verifyOtp',
      'updateUser',
      'signOut:others',
      'setSession',
      'cookie:par_lembrar',
    ]);
    expect(avulso.verifyOtp).toHaveBeenCalledWith({
      email: alvo,
      token: '12345678',
      type: 'email',
    });
    expect(avulso.updateUser).toHaveBeenCalledWith({ password: SENHA });
    expect(setSession).toHaveBeenCalledWith(SESSAO);
    // O client do cookie nao confere o codigo: se conferisse, a sessao
    // chegaria ao navegador antes da senha.
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it('o e-mail chega ao Supabase normalizado, como no cadastro', async () => {
    await expect(
      confirmarCadastro(codigoInicial, cadastro({ email: ` ${alvo.toUpperCase()} ` }))
    ).rejects.toThrow('redirect:/conta');

    expect(avulso.verifyOtp).toHaveBeenCalledWith(expect.objectContaining({ email: alvo }));
  });

  // Do cadastro nao vem "manter conectado": a sessao morre com o navegador,
  // e um `lembrar` forjado nao muda isso.
  it('a sessao nasce de navegador, mesmo com lembrar no formulario', async () => {
    await expect(confirmarCadastro(codigoInicial, cadastro({ lembrar: '1' }))).rejects.toThrow(
      'redirect:/conta'
    );

    expect(clienteDeAuth).toHaveBeenCalledWith(false);
    expect(jarSet).toHaveBeenCalledWith(
      'par_lembrar',
      '0',
      expect.objectContaining({ httpOnly: true, maxAge: undefined })
    );
  });

  it('termina na conta, com qualquer next', async () => {
    await expect(
      confirmarCadastro(codigoInicial, cadastro({ next: '/checkout?p=camiseta-cbac' }))
    ).rejects.toThrow('redirect:/conta');
  });

  // O caso comum: ninguem no meio, e a conta pendente ja tem esta senha.
  it('a mesma senha que ja estava na conta entra normalmente', async () => {
    avulso.updateUser.mockImplementationOnce(async () => {
      ordem.push('updateUser');
      return { error: { message: 'New password should be different', code: 'same_password' } };
    });

    await expect(confirmarCadastro(codigoInicial, cadastro())).rejects.toThrow('redirect:/conta');
    expect(ordem).toContain('setSession');
  });

  it('senha vazada: recusa antes de gastar o codigo', async () => {
    senhaVazada.mockResolvedValue(true);
    const r = await confirmarCadastro(codigoInicial, cadastro());

    expect(r.erro).toMatch(/vazamentos/);
    expect(r.erro).toMatch(/Trocar e-mail/);
    expect(senhaVazada).toHaveBeenCalledWith(SENHA);
    expect(ordem).toEqual([]);
  });

  it.each([
    ['vazia', { senha: '' }],
    ['curta', { senha: '1234567', confirmacao: '1234567' }],
    ['com confirmacao diferente', { confirmacao: 'outra coisa qualquer' }],
  ])('senha %s: recusa antes do codigo, com as regras do cadastro', async (_nome, troca) => {
    const r = await confirmarCadastro(codigoInicial, cadastro(troca));

    expect(r.erro).toMatch(/senha não veio/i);
    expect(senhaVazada).not.toHaveBeenCalled();
    expect(ordem).toEqual([]);
  });

  it('sem os campos da senha: recusa, sem chamar ninguem', async () => {
    const f = cadastro();
    f.delete('senha');
    f.delete('confirmacao');
    const r = await confirmarCadastro(codigoInicial, f);

    expect(r.erro).toMatch(/senha não veio/i);
    expect(ordem).toEqual([]);
  });

  it('codigo incompleto: a frase do codigo, mesmo com a senha certa', async () => {
    const r = await confirmarCadastro(codigoInicial, cadastro({ codigo: '1234567' }));

    expect(r.erro).toMatch(/8 dígitos/);
    expect(ordem).toEqual([]);
  });

  it('codigo errado: a mesma frase do login, e a senha nem e tocada', async () => {
    avulso.verifyOtp.mockImplementationOnce(async () => {
      ordem.push('verifyOtp');
      return { data: { session: null }, error: { message: 'Token has expired or is invalid' } };
    });
    verifyOtp.mockResolvedValue({ error: { message: 'Token has expired or is invalid' } });

    const doCadastro = await confirmarCadastro(codigoInicial, cadastro());
    const doLogin = await confirmarCodigo(
      codigoInicial,
      formulario({ email: email(), codigo: '12345678' })
    );

    expect(doCadastro.erro).toBe(doLogin.erro);
    expect(doCadastro.desfecho).toBeUndefined();
    expect(ordem).toEqual(['verifyOtp']);
  });

  // O e-mail ja esta confirmado e a senha pode ser de outra pessoa: nada de
  // sessao no navegador. O caminho e criar uma senha pela recuperacao.
  it('senha que nao gravou: sem sessao no navegador, e o desfecho e a recuperacao', async () => {
    avulso.updateUser.mockImplementationOnce(async () => {
      ordem.push('updateUser');
      return { error: { message: 'upstream request timeout', code: 'request_timeout' } };
    });

    const r = await confirmarCadastro(codigoInicial, cadastro());

    expect(r).toEqual({ erro: null, tentativa: 1, desfecho: 'sem-senha' });
    expect(ordem).toEqual(['verifyOtp', 'updateUser', 'signOut:global']);
    expect(clienteDeAuth).not.toHaveBeenCalled();
    expect(jarSet).not.toHaveBeenCalled();
  });

  it('sessao que nao chegou ao cookie: senha gravada, e o desfecho e o login', async () => {
    setSession.mockImplementationOnce(async () => {
      ordem.push('setSession');
      return { error: { message: 'fetch failed' } };
    });

    const r = await confirmarCadastro(codigoInicial, cadastro());

    expect(r).toEqual({ erro: null, tentativa: 1, desfecho: 'entrar' });
    expect(ordem).toEqual(['verifyOtp', 'updateUser', 'signOut:others', 'setSession']);
    expect(jarSet).not.toHaveBeenCalled();
  });

  // A senha vai e nao volta: nenhuma resposta a carrega.
  it('nenhuma resposta devolve a senha', async () => {
    senhaVazada.mockResolvedValueOnce(true);
    const vazada = await confirmarCadastro(codigoInicial, cadastro());
    const diferente = await confirmarCadastro(codigoInicial, cadastro({ confirmacao: 'outra' }));
    avulso.updateUser.mockImplementationOnce(async () => ({ error: { message: 'x' } }));
    const semSenha = await confirmarCadastro(codigoInicial, cadastro());

    for (const r of [vazada, diferente, semSenha]) {
      expect(JSON.stringify(r)).not.toContain(SENHA);
    }
  });

  it('isca preenchida e recusada antes de tudo', async () => {
    const r = await confirmarCadastro(codigoInicial, cadastro({ website: 'http://spam' }));

    expect(r.erro).toMatch(/robô/);
    expect(senhaVazada).not.toHaveBeenCalled();
    expect(ordem).toEqual([]);
  });

  // O mesmo contador do login: alternar entre as duas telas nao dobra os
  // chutes no mesmo e-mail.
  it('dez tentativas no mesmo e-mail, somadas as do login', async () => {
    // Cinco de cada lado: as que chegam ao Supabase antes do limite.
    for (let i = 0; i < 5; i++) {
      avulso.verifyOtp.mockImplementationOnce(async () => ({
        data: { session: null },
        error: { message: 'invalid' },
      }));
    }
    verifyOtp.mockResolvedValue({ error: { message: 'invalid' } });
    for (let i = 0; i < 10; i++) {
      cabecalhos = new Headers({ host: 'h', 'x-forwarded-for': `198.51.100.${200 + i}` });
      const f = cadastro();
      await (i % 2 ? confirmarCodigo(codigoInicial, f) : confirmarCadastro(codigoInicial, f));
    }
    cabecalhos = new Headers({ host: 'h', 'x-forwarded-for': '198.51.100.249' });
    const r = await confirmarCadastro(codigoInicial, cadastro());

    expect(r.erro).toMatch(/muitas tentativas/i);
    expect(avulso.verifyOtp).toHaveBeenCalledTimes(5);
    expect(verifyOtp).toHaveBeenCalledTimes(5);
  });
});

describe('reenviar o codigo (#224)', () => {
  const pedido = (extra: Record<string, string> = {}) =>
    formulario({ email: 'Maria@Exemplo.invalid', ...extra });

  it('pede outro e-mail de cadastro com o link de volta do proprio host', async () => {
    const r = await reenviarCodigo(reenvioInicial, pedido());

    expect(resend).toHaveBeenCalledWith({
      type: 'signup',
      email: 'maria@exemplo.invalid',
      options: { emailRedirectTo: 'https://passem-a-respeitar.test/auth/callback?next=%2Fconta' },
    });
    expect(r.erro).toBeNull();
    expect(r.aviso).toMatch(/se o e-mail for válido/i);
    expect(r.reenviadoEm).toBeGreaterThan(0);
  });

  it('conta que ja existe recebe o mesmo recado de sucesso', async () => {
    resend.mockResolvedValue({ error: { message: 'User already confirmed' } });
    const r = await reenviarCodigo(reenvioInicial, pedido());

    expect(r.erro).toBeNull();
    expect(r.aviso).toMatch(/se o e-mail for válido/i);
  });

  // O intervalo minimo do Supabase so acontece com cadastro pendente. Dizer
  // "espere um minuto" ali contava, a quem pedisse dois seguidos, quem esta no
  // meio do cadastro (#260). A resposta e a mesma de um envio que deu certo.
  it('o intervalo minimo do Supabase recebe o mesmo recado de sucesso', async () => {
    // Outro e-mail: o limite por e-mail guarda estado entre os casos.
    const certo = await reenviarCodigo(
      reenvioInicial,
      pedido({ email: 'pendente@exemplo.invalid' })
    );

    resend.mockResolvedValue({
      error: { message: 'For security purposes, you can only request this after 42 seconds.' },
    });
    const recusado = await reenviarCodigo(
      reenvioInicial,
      pedido({ email: 'pendente@exemplo.invalid' })
    );

    expect(recusado.erro).toBeNull();
    expect(recusado.aviso).toBe(certo.aviso);
    expect(recusado.reenviadoEm).toBeGreaterThan(0);
  });

  it('e-mail torto nao chega ao Supabase', async () => {
    const r = await reenviarCodigo(reenvioInicial, pedido({ email: 'nao-e-email' }));

    expect(r.erro).toMatch(/confira o e-mail/i);
    expect(resend).not.toHaveBeenCalled();
  });

  it('para depois de tres reenvios para o mesmo e-mail', async () => {
    const alvo = 'insistente@exemplo.invalid';
    for (let i = 0; i < 3; i++) {
      cabecalhos = new Headers({ host: 'h', 'x-forwarded-for': `198.51.100.${150 + i}` });
      await reenviarCodigo(reenvioInicial, pedido({ email: alvo }));
    }
    cabecalhos = new Headers({ host: 'h', 'x-forwarded-for': '198.51.100.198' });
    const r = await reenviarCodigo(reenvioInicial, pedido({ email: alvo }));

    expect(r.erro).toMatch(/muitos pedidos/i);
    expect(resend).toHaveBeenCalledTimes(3);
  });
});
