import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ambiente, limpa, opcoesComuns } from './opcoes';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('opcoesComuns', () => {
  // Sem DSN nao ha para onde mandar — e o site de quem nao tem conta no
  // Sentry roda igual.
  it('sem DSN o SDK fica desligado', () => {
    expect(opcoesComuns(undefined).enabled).toBe(false);
    expect(opcoesComuns('').enabled).toBe(false);
  });

  it('com DSN liga', () => {
    expect(opcoesComuns('https://x@o1.ingest.sentry.io/1').enabled).toBe(true);
  });

  // A v11 coleta tudo por padrao. Cada um destes e um lugar por onde a
  // sessao de alguem sairia para um painel de terceiro.
  it('desliga toda coleta de dado pessoal', () => {
    const { dataCollection } = opcoesComuns('https://x@o1.ingest.sentry.io/1');

    expect(dataCollection).toEqual({
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      stackFrameVariables: false,
    });
  });

  it('amostra traces, mas nao todos', () => {
    const { tracesSampleRate } = opcoesComuns('https://x@o1.ingest.sentry.io/1');
    expect(tracesSampleRate).toBeGreaterThan(0);
    expect(tracesSampleRate).toBeLessThan(1);
  });
});

describe('ambiente', () => {
  // No navegador, so as NEXT_PUBLIC_* existem: VERCEL_ENV chega vazio. Era
  // aqui que todo erro de producao virava 'development' (#256).
  it('no navegador de producao e production', () => {
    vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', 'production');
    vi.stubEnv('VERCEL_ENV', '');
    expect(ambiente()).toBe('production');
  });

  it('no navegador de preview e preview', () => {
    vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', 'preview');
    vi.stubEnv('VERCEL_ENV', '');
    expect(ambiente()).toBe('preview');
  });

  // Mesmo deploy, mesmo rotulo: o servidor tem as duas, o navegador so uma.
  it('servidor e navegador concordam', () => {
    vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', 'production');
    vi.stubEnv('VERCEL_ENV', 'production');
    const noServidor = ambiente();

    vi.stubEnv('VERCEL_ENV', '');
    expect(ambiente()).toBe(noServidor);
  });

  // Exposicao automatica desligada no painel: o servidor ainda acerta.
  it('so com VERCEL_ENV segue o VERCEL_ENV', () => {
    vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', '');
    vi.stubEnv('VERCEL_ENV', 'preview');
    expect(ambiente()).toBe('preview');
  });

  it('fora da Vercel e desenvolvimento', () => {
    vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', '');
    vi.stubEnv('VERCEL_ENV', '');
    expect(ambiente()).toBe('development');
  });

  // Valor estranho nao vira rotulo, e muito menos 'production'.
  it('valor desconhecido cai na proxima fonte', () => {
    vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', 'staging');
    vi.stubEnv('VERCEL_ENV', 'preview');
    expect(ambiente()).toBe('preview');

    vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', 'Production');
    vi.stubEnv('VERCEL_ENV', '');
    expect(ambiente()).toBe('development');
  });

  it('opcoesComuns leva o ambiente para o SDK', () => {
    vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', 'production');
    vi.stubEnv('VERCEL_ENV', '');
    expect(opcoesComuns('https://x@o1.ingest.sentry.io/1').environment).toBe('production');
  });

  // O teste acima roda em Node, onde qualquer forma de ler o ambiente
  // funciona. No bundle do navegador, so `process.env.NEXT_PUBLIC_X` escrito
  // por extenso e substituido no build; `process.env[nome]` chega undefined e
  // o bug volta sem nenhum teste de unidade perceber.
  it('le NEXT_PUBLIC_VERCEL_ENV na forma que o Next inlina', () => {
    const fonte = fs.readFileSync(path.join(__dirname, 'opcoes.ts'), 'utf8');
    expect(fonte).toMatch(/process\.env\.NEXT_PUBLIC_VERCEL_ENV\b/);
  });
});

type EventoSolto = { request?: Record<string, unknown>; user?: unknown; message?: string };

describe('limpa (segunda camada)', () => {
  it('tira cookies, corpo, query e o usuario', () => {
    const evento = limpa({
      request: {
        url: 'https://site/x',
        cookies: { 'sb-token': 'segredo' },
        data: { senha: '123' },
        query_string: 'token=abc',
        headers: { 'user-agent': 'x', cookie: 'sb=1', Authorization: 'Bearer t' },
      },
      user: { id: 'u1', email: 'a@b' },
    } as EventoSolto);

    expect(evento.request).toEqual({ url: 'https://site/x', headers: { 'user-agent': 'x' } });
    expect(evento.user).toBeUndefined();
  });

  it('evento sem request passa inteiro', () => {
    expect(limpa({ message: 'x' } as EventoSolto)).toEqual({ message: 'x' });
  });

  it('cabecalho sensivel sai em qualquer caixa', () => {
    const evento = limpa({
      request: { headers: { COOKIE: 'a', 'X-Signature': 'b', accept: 'c' } },
    } as EventoSolto);

    expect((evento as { request: { headers: Record<string, string> } }).request.headers).toEqual({
      accept: 'c',
    });
  });
});
