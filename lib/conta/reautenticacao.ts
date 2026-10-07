import 'server-only';

import { createClient } from '@supabase/supabase-js';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '@/lib/supabase/env';
import {
  cabecalhosDeOrigem,
  clienteDeAuth,
  clienteServidor,
  lembrarDaSessao,
  usuarioDaSessao,
} from '@/lib/supabase/servidor';

/**
 * Autenticacao recente para acoes sensiveis (Issue #40).
 *
 * A janela e lida do banco, nunca do cliente. Ver a migration
 * 20260923210000: quem responde e `auth.sessions.created_at`.
 */

export const JANELA_MINUTOS = 15;

export async function autenticadoRecentemente(minutos = JANELA_MINUTOS) {
  const supabase = await clienteServidor();
  const { data, error } = await supabase.rpc('autenticado_recentemente', {
    p_minutos: minutos,
  });

  // Falha fechada: se nao deu para saber, a acao sensivel nao passa. O custo
  // e a pessoa digitar a senha de novo; o custo do contrario e outro.
  if (error) return false;
  return data === true;
}

/**
 * Resultado de conferir uma senha. Tres, e nao dois (#244): `indisponivel` e
 * o Supabase recusando por limite, caindo ou fora de alcance. Tratar isso
 * como `errada` mandava "senha incorreta" para quem digitou a senha certa —
 * e no pico do lancamento, com varias pessoas confirmando senha pelo mesmo
 * IP de saida, isso aconteceria com todo mundo ao mesmo tempo.
 */
export type Conferencia = 'certa' | 'errada' | 'indisponivel';

/** O que as acoes mostram no terceiro caso. Uma frase so, para nao divergir. */
export const RECADO_INDISPONIVEL =
  'Não deu para conferir a senha agora. Tente de novo em instantes.';

/**
 * So `invalid_credentials` fala da senha. Qualquer outro erro — 429, 5xx,
 * rede sem resposta (status vazio) — fala do servico, e nao autoriza dizer
 * nada sobre o que a pessoa digitou.
 */
function classifica(error: { code?: string; status?: number } | null): Conferencia {
  if (!error) return 'certa';
  if (error.code === 'invalid_credentials') return 'errada';
  return 'indisponivel';
}

/**
 * Refaz o login para reiniciar a janela.
 *
 * Aqui o client da sessao E o certo, ao contrario da conferencia de senha da
 * #37: ali o objetivo era so verificar sem mexer em nada; aqui o objetivo e
 * justamente criar uma sessao nova, com carimbo novo, e gravar os cookies
 * dela.
 */
export async function reautenticar(senha: string): Promise<Conferencia> {
  const usuario = await usuarioDaSessao();
  // Sem sessao nao ha o que conferir. Quem chama ja barrou isso antes; se
  // chegou aqui assim, foi a sessao caindo no meio, e "tente de novo" e o
  // recado honesto — "senha incorreta" nao e.
  if (!usuario?.email) return 'indisponivel';

  // Guardado ANTES: depois do login novo o JWT ja aponta para outra sessao, e
  // esta aqui ficaria para tras sem ninguem para reclamar dela.
  const antes = await clienteServidor();
  const { data: anterior } = await antes.rpc('minha_sessao_atual');

  // A sessao nova herda a escolha da antiga. Com `true` fixo, quem nao marcou
  // "manter conectado" num computador emprestado saia daqui com cookies de
  // trinta dias so por ter confirmado a senha (#244).
  const supabase = await clienteDeAuth(await lembrarDaSessao());
  const { error } = await supabase.auth.signInWithPassword({
    email: usuario.email,
    password: senha,
  });

  const resultado = classifica(error);
  if (resultado !== 'certa') return resultado;

  // A sessao velha viraria aparelho fantasma na lista da #38 — um aparelho
  // que a pessoa nao consegue explicar, numa tela de seguranca. Agora que ela
  // nao e mais a atual, `encerra_sessao` aceita apaga-la.
  if (anterior) {
    const depois = await clienteServidor();
    await depois.rpc('encerra_sessao', { p_identificador: anterior });
  }

  return 'certa';
}

/**
 * Confere a senha sem tocar na sessao de quem pediu. Usado onde a acao ja
 * pede a senha no proprio formulario: troca de senha, de e-mail, exclusao.
 */
export async function senhaConfere(email: string, senha: string): Promise<Conferencia> {
  const avulso = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    // Os mesmos cabecalhos do client da sessao: a sessao que nasce aqui leva
    // o navegador e o IP de quem digitou, e o limite por IP do Supabase conta
    // contra esse IP — nao contra o de saida da Vercel, que e de todo mundo.
    global: { headers: await cabecalhosDeOrigem() },
  });

  const { error } = await avulso.auth.signInWithPassword({ email, password: senha });
  const resultado = classifica(error);

  // O login criou uma sessao de verdade no Supabase, com refresh token e
  // linha em auth.sessions. `persistSession: false` so evita gravar em disco;
  // nao evita a sessao. Ninguem a segura: sem encerrar, ela aparece em
  // "Aparelhos conectados" como um aparelho que a pessoa nao reconhece — numa
  // tela que manda encerrar e trocar a senha quando isso acontece (#244).
  //
  // `local`: so esta. `global` derrubaria a sessao da pessoa junto. O erro
  // daqui nao muda a resposta: a senha conferiu, e e isso que a acao quer
  // saber — a sessao sobrando e higiene, nao decisao.
  if (resultado === 'certa') await avulso.auth.signOut({ scope: 'local' });

  return resultado;
}
