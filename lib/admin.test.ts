import { afterEach, describe, expect, it, vi } from 'vitest';
import { ehAdmin } from './admin';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('ehAdmin', () => {
  it('e-mail da lista, verificado: sim', () => {
    vi.stubEnv('ADMIN_EMAILS', 'dono@whynot.test');
    expect(ehAdmin({ email: 'dono@whynot.test', emailVerificado: true })).toBe(true);
  });

  it('nao liga para maiuscula nem espaco, nos dois lados', () => {
    vi.stubEnv('ADMIN_EMAILS', ' Dono@WhyNot.test , outra@whynot.test');
    expect(ehAdmin({ email: 'DONO@whynot.test ', emailVerificado: true })).toBe(true);
    expect(ehAdmin({ email: 'outra@whynot.test', emailVerificado: true })).toBe(true);
  });

  // Quem cadastrar o e-mail do dono antes dele — sem confirmar — nao pode
  // virar administrador ate a confirmacao.
  it('e-mail da lista, NAO verificado: nao', () => {
    vi.stubEnv('ADMIN_EMAILS', 'dono@whynot.test');
    expect(ehAdmin({ email: 'dono@whynot.test', emailVerificado: false })).toBe(false);
  });

  it('e-mail fora da lista: nao', () => {
    vi.stubEnv('ADMIN_EMAILS', 'dono@whynot.test');
    expect(ehAdmin({ email: 'cliente@exemplo.test', emailVerificado: true })).toBe(false);
  });

  // Falha fechada.
  it('sem a variavel, ninguem e administrador', () => {
    vi.stubEnv('ADMIN_EMAILS', '');
    expect(ehAdmin({ email: 'dono@whynot.test', emailVerificado: true })).toBe(false);
  });

  it('sem e-mail na sessao: nao', () => {
    vi.stubEnv('ADMIN_EMAILS', 'dono@whynot.test');
    expect(ehAdmin({ email: null, emailVerificado: true })).toBe(false);
  });

  // `dono@whynot.test` nao pode ser aceito por prefixo ou sufixo.
  it('compara o e-mail inteiro', () => {
    vi.stubEnv('ADMIN_EMAILS', 'dono@whynot.test');
    expect(ehAdmin({ email: 'dono@whynot.test.evil', emailVerificado: true })).toBe(false);
    expect(ehAdmin({ email: 'xdono@whynot.test', emailVerificado: true })).toBe(false);
  });
});
