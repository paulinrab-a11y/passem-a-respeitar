import 'server-only';

import { createClient } from '@supabase/supabase-js';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '@/lib/supabase/env';
import { clienteDeAuth, clienteServidor, usuarioDaSessao } from '@/lib/supabase/servidor';

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
 * Refaz o login para reiniciar a janela.
 *
 * Aqui o client da sessao E o certo, ao contrario da conferencia de senha da
 * #37: ali o objetivo era so verificar sem mexer em nada; aqui o objetivo e
 * justamente criar uma sessao nova, com carimbo novo, e gravar os cookies
 * dela.
 */
export async function reautenticar(senha: string) {
  const usuario = await usuarioDaSessao();
  if (!usuario?.email) return false;

  // Guardado ANTES: depois do login novo o JWT ja aponta para outra sessao, e
  // esta aqui ficaria para tras sem ninguem para reclamar dela.
  const antes = await clienteServidor();
  const { data: anterior } = await antes.rpc('minha_sessao_atual');

  const supabase = await clienteDeAuth(true);
  const { error } = await supabase.auth.signInWithPassword({
    email: usuario.email,
    password: senha,
  });

  if (error) return false;

  // A sessao velha viraria aparelho fantasma na lista da #38 — um aparelho
  // que a pessoa nao consegue explicar, numa tela de seguranca. Agora que ela
  // nao e mais a atual, `encerra_sessao` aceita apaga-la.
  if (anterior) {
    const depois = await clienteServidor();
    await depois.rpc('encerra_sessao', { p_identificador: anterior });
  }

  return true;
}

/**
 * Confere a senha sem tocar na sessao. Usado onde a acao ja pede a senha no
 * proprio formulario, como a exclusao de conta.
 */
export async function senhaConfere(email: string, senha: string) {
  const avulso = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error } = await avulso.auth.signInWithPassword({ email, password: senha });
  return !error;
}
