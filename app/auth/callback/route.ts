import { type NextRequest, NextResponse } from 'next/server';
import { destinoSeguro, ENTRAR } from '@/lib/rotas';
import { clienteDeAuth } from '@/lib/supabase/servidor';

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
 * `next` e validado por `destinoSeguro`: a query vem do e-mail, e e-mail e
 * texto que qualquer um forja. Sem isso o link de confirmacao seria um open
 * redirect com a assinatura do site.
 */

const REDEFINIR = '/redefinir-senha';

const TIPOS = new Set(['signup', 'recovery', 'email', 'email_change', 'magiclink', 'invite']);

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  // `destinoSeguro` so aceita rotas de conta; a redefinicao de senha (#32) e
  // a unica excecao, e e literal — nada de prefixo ou padrao.
  const pedido = searchParams.get('next');
  const next = pedido === REDEFINIR ? REDEFINIR : destinoSeguro(pedido);
  const tipo = searchParams.get('type');

  const code = searchParams.get('code');
  const tokenHash = searchParams.get('token_hash');

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

  if (falhou) {
    // Link usado, vencido ou inventado: para a recuperacao, volta ao pedido;
    // para o resto, ao login. Sem detalhe do motivo — "expirado" e "falso"
    // recebem a mesma tela.
    const volta = tipo === 'recovery' ? '/recuperar-senha' : ENTRAR;
    const url = new URL(volta, origin);
    url.searchParams.set('erro', 'link');
    return NextResponse.redirect(url);
  }

  return NextResponse.redirect(new URL(next, origin));
}
