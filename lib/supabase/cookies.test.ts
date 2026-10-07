import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ehVerificador,
  opcoesDaRecuperacao,
  opcoesDeSessao,
  opcoesDoLembrar,
  opcoesDoVerificador,
} from './cookies';

const DO_SUPABASE = { maxAge: 60 * 60 * 24 * 365, path: '/', sameSite: 'lax' as const };

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('opcoesDeSessao', () => {
  it('forca httpOnly, qualquer que seja a sugestao', () => {
    expect(opcoesDeSessao({ ...DO_SUPABASE, httpOnly: false }, true).httpOnly).toBe(true);
  });

  it('forca sameSite lax', () => {
    // O tipo do Supabase aceita boolean em sameSite, heranca da biblioteca de
    // cookie por baixo. `true` ali viraria Strict, que quebraria a volta do
    // link de confirmacao de e-mail.
    expect(opcoesDeSessao({ sameSite: true }, true).sameSite).toBe('lax');
  });

  it('cai no path raiz quando o Supabase nao manda', () => {
    expect(opcoesDeSessao({}, true).path).toBe('/');
  });

  it('marca secure em producao', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(opcoesDeSessao(DO_SUPABASE, true).secure).toBe(true);
  });

  // Em http o navegador descarta cookie secure. Sem esta diferenca o login
  // local pararia de funcionar sem dizer por que.
  it('nao marca secure em desenvolvimento', () => {
    vi.stubEnv('NODE_ENV', 'development');
    expect(opcoesDeSessao(DO_SUPABASE, true).secure).toBe(false);
  });

  describe('manter conectado', () => {
    it('marcado mantem a validade que o Supabase pediu', () => {
      const o = opcoesDeSessao(DO_SUPABASE, true);
      expect(o.maxAge).toBe(DO_SUPABASE.maxAge);
    });

    // Sem maxAge e sem expires o cookie morre ao fechar o navegador. E o que a
    // caixa desmarcada significa num computador emprestado.
    it('desmarcado vira cookie de sessao', () => {
      const o = opcoesDeSessao(DO_SUPABASE, false);
      expect(o.maxAge).toBeUndefined();
      expect(o.expires).toBeUndefined();
    });

    it('desmarcado tambem descarta expires', () => {
      const o = opcoesDeSessao({ expires: new Date('2030-01-01') }, false);
      expect(o.expires).toBeUndefined();
    });
  });
});

describe('opcoesDoLembrar', () => {
  it('sobrevive ao fechar o navegador quando marcado', () => {
    expect(opcoesDoLembrar(true).maxAge).toBeGreaterThan(0);
  });

  it('e cookie de sessao quando desmarcado', () => {
    expect(opcoesDoLembrar(false).maxAge).toBeUndefined();
  });

  it('tambem e httpOnly', () => {
    // Nao e o token, mas diz respeito a sessao. Nao ha motivo para JavaScript
    // de pagina conseguir ler nem escrever.
    expect(opcoesDoLembrar(true).httpOnly).toBe(true);
  });
});

describe('verificador PKCE (#234)', () => {
  it('reconhece o cookie do verificador pelo sufixo', () => {
    expect(ehVerificador('sb-abc-auth-token-code-verifier')).toBe(true);
    expect(ehVerificador('sb-abc-auth-token')).toBe(false);
  });

  it('vale uma hora mesmo sem manter conectado, e continua httpOnly', () => {
    const o = opcoesDoVerificador(DO_SUPABASE);
    expect(o.maxAge).toBe(60 * 60);
    expect(o.expires).toBeUndefined();
    expect(o.httpOnly).toBe(true);
    expect(o.sameSite).toBe('lax');
  });
});

describe('marca da recuperacao (#234)', () => {
  it('e curta, httpOnly e so do servidor', () => {
    const o = opcoesDaRecuperacao();
    expect(o.maxAge).toBe(30 * 60);
    expect(o.httpOnly).toBe(true);
    expect(o.sameSite).toBe('lax');
    expect(o.path).toBe('/');
  });
});
