import { afterEach, describe, expect, it, vi } from 'vitest';
import { codigoConfere, cookieValido, criaCookie, teaserEmbed } from './convite';

// Codigos inventados so para o teste. O codigo real nunca entra aqui — nem ele
// nem o hash dele: o repositorio e publico e hash de codigo curto cai em
// dicionario. Os hashes abaixo sao SHA-256 destas strings de mentira.
const ALFA = 'codigo-de-teste-alfa';
const HASH_ALFA = '30a9fb7241d4cdb850057b6e2e025fb266ef3fceb5cd39f246267b93a0978147';
const HASH_BETA = '4fd9a659ba9ae3f0946074d9d06e177f43f98017eb2b43cd6eb3cf4d38e5d51f';
const HASH_GAMA = '445bfbdd3fbf9672ce2fb0b1d8e980f8275609cfa553541a5db01846c8856332';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('codigoConfere', () => {
  it('recusa tudo quando nao ha hash configurado', async () => {
    vi.stubEnv('CONVITE_CODIGOS_HASH', '');
    expect(await codigoConfere(ALFA)).toBe(false);
  });

  it('aceita o codigo certo', async () => {
    vi.stubEnv('CONVITE_CODIGOS_HASH', HASH_ALFA);
    expect(await codigoConfere(ALFA)).toBe(true);
  });

  it('recusa codigo errado', async () => {
    vi.stubEnv('CONVITE_CODIGOS_HASH', HASH_ALFA);
    expect(await codigoConfere('codigo-errado')).toBe(false);
  });

  it('distingue maiuscula de minuscula', async () => {
    vi.stubEnv('CONVITE_CODIGOS_HASH', HASH_ALFA);
    expect(await codigoConfere(ALFA.toUpperCase())).toBe(false);
  });

  // A funcao percorre a lista inteira sem sair no primeiro acerto, para que o
  // tempo de resposta nao entregue a posicao. Este teste garante que o ultimo
  // da fila e alcancado — se alguem trocar o laco por um `return` antecipado
  // para "otimizar", ele cai.
  it('acha o codigo mesmo sendo o ultimo da lista', async () => {
    vi.stubEnv('CONVITE_CODIGOS_HASH', `${HASH_BETA},${HASH_GAMA},${HASH_ALFA}`);
    expect(await codigoConfere(ALFA)).toBe(true);
  });

  it('ignora entrada malformada sem derrubar a lista', async () => {
    vi.stubEnv('CONVITE_CODIGOS_HASH', `nao-e-hash,  ${HASH_ALFA}  ,xyz`);
    expect(await codigoConfere(ALFA)).toBe(true);
  });

  it('aceita hash em maiuscula na configuracao', async () => {
    vi.stubEnv('CONVITE_CODIGOS_HASH', HASH_ALFA.toUpperCase());
    expect(await codigoConfere(ALFA)).toBe(true);
  });

  it('recusa quando a configuracao so tem lixo', async () => {
    vi.stubEnv('CONVITE_CODIGOS_HASH', 'nao-e-hash,,   ,123');
    expect(await codigoConfere(ALFA)).toBe(false);
  });
});

describe('cookie de acesso', () => {
  it('nao emite cookie sem segredo', async () => {
    vi.stubEnv('CONVITE_COOKIE_SECRET', '');
    expect(await criaCookie()).toBe(null);
  });

  it('aceita o cookie que acabou de emitir', async () => {
    vi.stubEnv('CONVITE_COOKIE_SECRET', 'segredo-de-teste');
    const cookie = await criaCookie();
    expect(cookie).not.toBe(null);
    expect(await cookieValido(cookie?.valor)).toBe(true);
  });

  it('recusa assinatura adulterada', async () => {
    vi.stubEnv('CONVITE_COOKIE_SECRET', 'segredo-de-teste');
    const cookie = await criaCookie();
    const [v, exp, hmac] = (cookie?.valor ?? '').split('.');
    const trocado = hmac[0] === 'a' ? 'b' : 'a';
    expect(await cookieValido(`${v}.${exp}.${trocado}${hmac.slice(1)}`)).toBe(false);
  });

  // O teste que da sentido aos outros: se a verificacao do HMAC nao estivesse
  // de fato acontecendo, um cookie assinado por qualquer um passaria, e o
  // cookie deixaria de ser prova de que a pessoa acertou o codigo.
  it('recusa cookie assinado com outro segredo', async () => {
    vi.stubEnv('CONVITE_COOKIE_SECRET', 'segredo-do-atacante');
    const forjado = await criaCookie();

    vi.stubEnv('CONVITE_COOKIE_SECRET', 'segredo-de-teste');
    expect(await cookieValido(forjado?.valor)).toBe(false);
  });

  it('recusa cookie expirado', async () => {
    vi.stubEnv('CONVITE_COOKIE_SECRET', 'segredo-de-teste');
    const cookie = await criaCookie();

    // 31 dias adiante; a validade e de 30.
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 31 * 24 * 60 * 60 * 1000);
    expect(await cookieValido(cookie?.valor)).toBe(false);
  });

  it('recusa expiracao que nao e numero', async () => {
    vi.stubEnv('CONVITE_COOKIE_SECRET', 'segredo-de-teste');
    expect(await cookieValido('v1.amanha.abc')).toBe(false);
  });

  it.each([
    ['vazio', ''],
    ['sem as tres partes', 'v1.123'],
    ['versao desconhecida', 'v2.9999999999.abc'],
    ['indefinido', undefined],
  ])('recusa cookie %s', async (_nome, valor) => {
    vi.stubEnv('CONVITE_COOKIE_SECRET', 'segredo-de-teste');
    expect(await cookieValido(valor)).toBe(false);
  });

  it('recusa qualquer cookie quando o segredo sumiu do ambiente', async () => {
    vi.stubEnv('CONVITE_COOKIE_SECRET', 'segredo-de-teste');
    const cookie = await criaCookie();

    vi.stubEnv('CONVITE_COOKIE_SECRET', '');
    expect(await cookieValido(cookie?.valor)).toBe(false);
  });
});

describe('teaserEmbed', () => {
  it('devolve null quando nao ha url', () => {
    vi.stubEnv('CONVITE_TEASER_EMBED', '');
    expect(teaserEmbed()).toBe(null);
  });

  it('devolve a url https', () => {
    vi.stubEnv('CONVITE_TEASER_EMBED', '  https://exemplo.invalid/embed  ');
    expect(teaserEmbed()).toBe('https://exemplo.invalid/embed');
  });

  it('recusa http', () => {
    vi.stubEnv('CONVITE_TEASER_EMBED', 'http://exemplo.invalid/embed');
    expect(teaserEmbed()).toBe(null);
  });

  it('recusa javascript:', () => {
    vi.stubEnv('CONVITE_TEASER_EMBED', 'javascript:alert(1)');
    expect(teaserEmbed()).toBe(null);
  });
});
