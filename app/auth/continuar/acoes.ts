'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { destinoDoLink, ehHashDeLink, ehTipoDeLink } from '@/lib/conta/link-do-email';
import { criaMarcaDeRecuperacao } from '@/lib/conta/recuperacao';
import { ipDoRequest, limita } from '@/lib/rate-limit';
import { ENTRAR } from '@/lib/rotas';
import {
  COOKIE_LEMBRAR,
  COOKIE_RECUPERACAO,
  opcoesDaRecuperacao,
  opcoesDoLembrar,
} from '@/lib/supabase/cookies';
import { clienteDeAuth } from '@/lib/supabase/servidor';

/**
 * O POST do botao "Continuar" (#348): e aqui, e nao no GET do link, que o
 * `token_hash` vira sessao.
 *
 * Server Action e POST com a checagem de origem do proprio Next: o pedido so
 * passa se o `Origin` for o mesmo host da pagina. Entao a sessao so nasce de
 * um clique NESTA pagina, no navegador de quem esta com ela aberta — nao de
 * um verificador de links abrindo o e-mail, nem de outro site mandando o
 * formulario. O token continua de uso unico e com prazo: isso e do Supabase.
 *
 * Nada aqui distingue "vencido" de "falso": os dois voltam com o mesmo aviso.
 */

/** Por IP: o token e longo demais para chute, isto so corta rajada. */
const POR_IP = { maximo: 20, janelaMs: 60 * 60 * 1000 };

export async function continuarLink(form: FormData) {
  const tipo = form.get('type');
  const tokenHash = form.get('token_hash');
  const next = form.get('next');

  const recuperacao = tipo === 'recovery';
  const falha = () => {
    redirect(`${recuperacao ? '/recuperar-senha' : ENTRAR}?erro=link`);
  };

  if (!ehTipoDeLink(tipo) || !ehHashDeLink(tokenHash)) return falha();

  const cota = await limita(
    `continuar:ip:${ipDoRequest(await headers())}`,
    POR_IP.maximo,
    POR_IP.janelaMs
  );
  if (!cota.permitido) return falha();

  // `lembrar: false`: a sessao que nasce do link morre com o navegador. Quem
  // quiser ficar conectado entra de novo e marca.
  const supabase = await clienteDeAuth(false);
  const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: tipo });
  if (error) {
    // So o tipo: o hash e credencial, e credencial nao vai para log.
    console.warn(`auth/continuar: link recusado tipo=${tipo}`);
    return falha();
  }

  const jar = await cookies();
  // A escolha de quem usou o navegador antes nao passa para esta sessao.
  jar.set(COOKIE_LEMBRAR, '0', opcoesDoLembrar(false));

  // A marca so para a recuperacao, assinada e presa a esta conta. Qualquer
  // outro link apaga a que houvesse: ela seria de outra sessao.
  const marca = recuperacao && data.user ? criaMarcaDeRecuperacao(data.user.id) : null;
  if (marca) jar.set(COOKIE_RECUPERACAO, marca, opcoesDaRecuperacao());
  else jar.delete(COOKIE_RECUPERACAO);

  // Fora de try/catch: `redirect` funciona lancando.
  redirect(destinoDoLink(tipo, typeof next === 'string' ? next : null));
}
