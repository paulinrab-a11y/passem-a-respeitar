/**
 * Opcoes dos cookies de sessao, num lugar so.
 *
 * Duas partes escrevem esses cookies: a acao de login e o middleware, que
 * renova o token a cada request de conta. Se as duas nao concordarem, o
 * "manter conectado" desligado vira ligado sozinho na primeira renovacao —
 * o middleware gravaria de novo com a validade cheia do Supabase.
 *
 * Por isso a escolha da pessoa vira um cookie proprio, e nao estado em
 * memoria: o middleware precisa dela em outro request, em outra instancia.
 */

export const COOKIE_LEMBRAR = 'par_lembrar';

/**
 * Marca de "esta sessao nasceu do link de recuperacao" (#234). O callback
 * grava; /redefinir-senha so troca a senha com ela presente. Sem isso, uma
 * sessao de login comum — computador emprestado, aba esquecida — trocaria a
 * senha sem saber a atual, o que a troca normal em /conta/seguranca exige.
 */
export const COOKIE_RECUPERACAO = 'par_recuperacao';

/** Meia hora para escolher a senha nova depois de clicar no link. */
const RECUPERACAO_SEGUNDOS = 30 * 60;

/** Quanto o verificador PKCE sobrevive: o mesmo que o link do e-mail vale. */
const VERIFICADOR_SEGUNDOS = 60 * 60;

/**
 * O que o Supabase entrega. `sameSite` aceita boolean no tipo dele, que e
 * legado da biblioteca de cookie por baixo — por isso a entrada e mais larga
 * que a saida.
 */
type OpcoesDoSupabase = {
  maxAge?: number;
  expires?: Date;
  path?: string;
  domain?: string;
  sameSite?: boolean | 'lax' | 'strict' | 'none';
  secure?: boolean;
  httpOnly?: boolean;
};

/** O que sai daqui, ja endurecido. */
type Opcoes = {
  maxAge?: number;
  expires?: Date;
  path: string;
  domain?: string;
  sameSite: 'lax';
  secure: boolean;
  httpOnly: true;
};

const producao = () => process.env.NODE_ENV === 'production';

/**
 * Endurece as opcoes que o Supabase sugere e aplica o "manter conectado".
 *
 * - httpOnly: o token deixa de ser legivel por JavaScript. Com isso um XSS
 *   nao consegue roubar a sessao, mas o client do navegador tambem nao le
 *   mais a sessao — por isso toda tela de conta e renderizada no servidor.
 * - secure fora de desenvolvimento: em http o navegador descarta cookie
 *   secure, e o login local pararia de funcionar sem dizer por que.
 * - sameSite lax: o cookie acompanha navegacao vinda de fora (link no
 *   e-mail de confirmacao), mas nao acompanha POST de outro site.
 */
export function opcoesDeSessao(base: OpcoesDoSupabase | undefined, lembrar: boolean): Opcoes {
  const opcoes: Opcoes = {
    maxAge: base?.maxAge,
    expires: base?.expires,
    domain: base?.domain,
    path: base?.path ?? '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: producao(),
  };

  if (!lembrar) {
    // Sem maxAge e sem expires o cookie morre quando o navegador fecha. E o
    // que "nao manter conectado" significa num computador emprestado.
    opcoes.maxAge = undefined;
    opcoes.expires = undefined;
  }

  return opcoes;
}

/**
 * O cookie do verificador PKCE (`*-code-verifier`) nao e cookie de sessao
 * (#234). O @supabase/ssr grava o verificador quando o pedido de link sai e
 * precisa dele quando o link volta. Com "manter conectado" desligado,
 * `opcoesDeSessao` o transformava em cookie de sessao: fechar o navegador
 * entre pedir e clicar matava o link. Vale uma hora, como o proprio link.
 */
export function ehVerificador(nome: string) {
  return nome.endsWith('-code-verifier');
}

export function opcoesDoVerificador(base: OpcoesDoSupabase | undefined): Opcoes {
  const opcoes = opcoesDeSessao(base, true);
  opcoes.maxAge = VERIFICADOR_SEGUNDOS;
  opcoes.expires = undefined;
  return opcoes;
}

/** O cookie da recuperacao: curto, e so o servidor le. */
export function opcoesDaRecuperacao(): Opcoes {
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: producao(),
    maxAge: RECUPERACAO_SEGUNDOS,
  };
}

/** Cookie que registra a escolha. Mesma validade do login persistente. */
export function opcoesDoLembrar(lembrar: boolean): Opcoes {
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: producao(),
    maxAge: lembrar ? 60 * 60 * 24 * 30 : undefined,
  };
}
