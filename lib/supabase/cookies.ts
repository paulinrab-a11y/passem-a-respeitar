/**
 * Opcoes dos cookies de sessao, num lugar so.
 *
 * Tres partes escrevem esses cookies: as acoes de login, o middleware, que
 * renova o token nas rotas de conta, e qualquer leitura de sessao no servidor
 * (`clienteServidor`), que renova o token vencido nas rotas que o middleware
 * nao cobre, como a home e `/api`. Se uma delas nao concordar com as outras, o
 * "manter conectado" desligado vira ligado sozinho na primeira renovacao, e o
 * token volta a ser legivel por JavaScript. Todas passam por `opcoesDoCookie`.
 *
 * Por isso tambem a escolha da pessoa vira um cookie proprio, e nao estado em
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
 * O @supabase/ssr apaga cookie regravando-o vazio com `maxAge: 0` — no logout
 * e quando o token encolhe e sobra um pedaco (`.1`) da versao anterior.
 * Apagar tem que continuar apagando: tirar o maxAge, como o "nao manter
 * conectado" faz, transformaria a ordem de apagar num cookie vazio que fica
 * no navegador ate ele fechar.
 */
function ehApagamento(base: OpcoesDoSupabase | undefined) {
  return base?.maxAge === 0;
}

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

  if (!lembrar && !ehApagamento(base)) {
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
  // Depois que o link volta, o Supabase apaga o verificador; fixar uma hora
  // aqui o deixaria vazio no navegador por mais uma hora.
  opcoes.maxAge = ehApagamento(base) ? 0 : VERIFICADOR_SEGUNDOS;
  opcoes.expires = undefined;
  return opcoes;
}

/**
 * As opcoes de qualquer cookie que o Supabase pede para gravar: o
 * verificador PKCE tem validade propria, o resto e sessao. E a unica porta
 * — login, middleware e `clienteServidor` chamam isto, e nenhum repassa as
 * opcoes do Supabase cruas. As cruas sao `httpOnly: false` e 400 dias.
 */
export function opcoesDoCookie(
  nome: string,
  base: OpcoesDoSupabase | undefined,
  lembrar: boolean
): Opcoes {
  return ehVerificador(nome) ? opcoesDoVerificador(base) : opcoesDeSessao(base, lembrar);
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
