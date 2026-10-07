import { type NextRequest, NextResponse } from 'next/server';
import { destinoSeguro, ENTRAR } from '@/lib/rotas';
import { origemDoPedido } from '@/lib/site-url';
import { COOKIE_RECUPERACAO, opcoesDaRecuperacao } from '@/lib/supabase/cookies';
import { clienteDeAuth, usuarioDaSessao } from '@/lib/supabase/servidor';

export const dynamic = 'force-dynamic';

/**
 * Ponto de volta dos links de e-mail (Issues #30 e #32).
 *
 * O Supabase manda a pessoa para ca depois de confirmar o cadastro ou pedir
 * recuperacao de senha. Duas formas de link chegam aqui, e as duas terminam
 * numa sessao gravada em cookie:
 *
 *   ?code=…                     fluxo PKCE, o padrao do @supabase/ssr:
 *                               troca o codigo por sessao
 *   ?token_hash=…&type=…        link com o hash direto, que o template de
 *                               e-mail pode montar; confere pelo verifyOtp
 *
 * Os dois sao de uso unico e vencem: token repetido ou velho e recusado pelo
 * proprio Supabase, e aqui vira redirecionamento com aviso — nunca sessao.
 *
 * A troca de e-mail (#36) traz dois casos a mais, porque pede confirmacao nos
 * dois enderecos e os dois links costumam ser abertos em lugares diferentes:
 *
 *   ?message=…                  primeira das duas confirmacoes. O Supabase
 *                               aceitou o link e nao ha codigo para trocar:
 *                               ainda falta o outro endereco.
 *   ?code=… sem o verificador   segunda confirmacao aberta em outro navegador.
 *                               A troca JA aconteceu no Supabase; so nao da
 *                               para criar sessao aqui.
 *
 * Em nenhum dos dois nasce sessao. Quem ja tem sessao segue para a conta, que
 * mostra o estado real lido do servidor; quem nao tem cai no login, sem o
 * aviso de link invalido — o link valeu.
 *
 * `next` e validado por `destinoSeguro`: a query vem do e-mail, e e-mail e
 * texto que qualquer um forja. Sem isso o link de confirmacao seria um open
 * redirect com a assinatura do site.
 *
 * Recuperacao de senha (#234): o e-mail traz o link com `token_hash`, que
 * nao depende de cookie do navegador que PEDIU — o fluxo PKCE dependia, e
 * quem pedia no celular e abria no computador caia no login. A sessao que
 * nasce aqui para redefinir a senha recebe a marca `par_recuperacao`: so com
 * ela /redefinir-senha troca a senha sem pedir a atual.
 */

const REDEFINIR = '/redefinir-senha';

const TIPOS = new Set(['signup', 'recovery', 'email', 'email_change', 'magiclink', 'invite']);

/**
 * Registra por que um link falhou (#139).
 *
 * O Supabase manda o motivo na URL (`error_code=otp_expired`, por exemplo) e
 * sem isso uma falha em producao e so "caiu no login". O que entra no log:
 *
 *   - o codigo do erro, e so se tiver cara de codigo
 *   - os NOMES dos parametros que chegaram
 *
 * O que nunca entra: valor de `code`, de `token_hash` ou de qualquer outro
 * parametro. Codigo de autorizacao em log e credencial em log.
 */
const CARA_DE_CODIGO = /^[a-z0-9_]{1,64}$/;

function registraFalha(searchParams: URLSearchParams, etapa: string) {
  const bruto = searchParams.get('error_code') ?? '';
  const motivo = CARA_DE_CODIGO.test(bruto) ? bruto : bruto ? 'fora_do_formato' : 'sem_codigo';
  const nomes = [...new Set(searchParams.keys())]
    .filter((n) => CARA_DE_CODIGO.test(n))
    .sort()
    .join(',');

  console.warn(`auth/callback: link recusado etapa=${etapa} motivo=${motivo} parametros=${nomes}`);
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  // O host por onde o pedido chegou, e nao o que o Next calculou: e nele que
  // o navegador guarda o cookie da sessao que nasce aqui (#168).
  const origin = origemDoPedido(request.headers, request.nextUrl.origin);
  // `destinoSeguro` so aceita rotas de conta; a redefinicao de senha (#32) e
  // a unica excecao, e e literal — nada de prefixo ou padrao.
  const pedido = searchParams.get('next');
  const next = pedido === REDEFINIR ? REDEFINIR : destinoSeguro(pedido);
  const tipo = searchParams.get('type');

  const code = searchParams.get('code');
  const tokenHash = searchParams.get('token_hash');
  // O redirect PKCE nao traz `type`; o `next` da recuperacao e literal e so
  // ela o usa, entao serve de sinal tambem.
  const recuperacao = tipo === 'recovery' || next === REDEFINIR;

  // Recuperacao de senha "manter conectado" nao faz sentido: a sessao que
  // nasce aqui existe para redefinir a senha, e morre com o navegador.
  const supabase = await clienteDeAuth(false);

  let falhou = true;

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    falhou = Boolean(error);
  } else if (tokenHash && tipo && TIPOS.has(tipo)) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: tipo as 'signup' | 'recovery' | 'email' | 'email_change' | 'magiclink' | 'invite',
    });
    falhou = Boolean(error);
  }

  // `message` e so um sinal para NAO acusar link invalido. Nada e concedido
  // por causa dele: forjar o parametro leva ao login, ou a conta de quem ja
  // estava logado.
  const semCodigo = !code && !tokenHash;
  const confirmacaoParcial = semCodigo && searchParams.has('message') && !searchParams.has('error');

  if (confirmacaoParcial || (falhou && code && !searchParams.has('error'))) {
    const logado = await usuarioDaSessao();
    if (logado) return NextResponse.redirect(new URL(next, origin));
    if (confirmacaoParcial) return NextResponse.redirect(new URL(ENTRAR, origin));
  }

  if (falhou) {
    registraFalha(
      searchParams,
      code ? 'troca_do_codigo' : tokenHash ? 'token_hash' : 'sem_credencial'
    );

    // Link usado, vencido ou inventado: para a recuperacao, volta ao pedido;
    // para o resto, ao login. Sem detalhe do motivo — "expirado" e "falso"
    // recebem a mesma tela.
    const volta = recuperacao ? '/recuperar-senha' : ENTRAR;
    const url = new URL(volta, origin);
    url.searchParams.set('erro', 'link');
    return NextResponse.redirect(url);
  }

  const resposta = NextResponse.redirect(new URL(next, origin));
  if (recuperacao) resposta.cookies.set(COOKIE_RECUPERACAO, '1', opcoesDaRecuperacao());
  return resposta;
}
