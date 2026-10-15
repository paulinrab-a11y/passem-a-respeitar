'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { RECADO_INDISPONIVEL, senhaConfere } from '@/lib/conta/reautenticacao';
import { limita } from '@/lib/rate-limit';
import { clienteAdmin } from '@/lib/supabase/admin';
import { COOKIE_LEMBRAR, COOKIE_RECUPERACAO } from '@/lib/supabase/cookies';
import { clienteServidor, usuarioDaSessao } from '@/lib/supabase/servidor';
import type { EstadoExclusao } from './estado-exclusao';

/**
 * Exclusao de conta (LGPD, Issue #39).
 *
 * Acao irreversivel, entao o atrito e proposital: a pessoa digita o proprio
 * e-mail E a senha. O e-mail evita o clique errado; a senha evita que quem
 * sentou no computador alheio apague a conta de outra pessoa.
 *
 * A senha aqui faz o papel da reautenticacao recente que a #40 vai
 * generalizar. Conferir a senha AGORA e mais forte que uma janela de 15
 * minutos, entao esta acao nao fica devendo nada quando a #40 entrar.
 */

/** Tres por hora. Ninguem exclui a conta duas vezes. */
const LIMITE = { maximo: 3, janelaMs: 60 * 60 * 1000 };

function erro(texto: string): EstadoExclusao {
  return { recado: { tom: 'erro', texto } };
}

export async function excluirConta(
  _anterior: EstadoExclusao,
  form: FormData
): Promise<EstadoExclusao> {
  const usuario = await usuarioDaSessao();
  if (!usuario?.email) {
    return erro('Sua sessão expirou. Entre de novo.');
  }

  const cota = await limita(`excluir:${usuario.id}`, LIMITE.maximo, LIMITE.janelaMs);
  if (!cota.permitido) {
    return erro('Muitas tentativas. Tente de novo mais tarde.');
  }

  const digitado = String(form.get('email') ?? '')
    .trim()
    .toLowerCase();
  const senha = String(form.get('senha') ?? '');

  if (digitado !== usuario.email.toLowerCase()) {
    return erro('O e-mail digitado não é o desta conta.');
  }

  // Client descartavel, como na troca de senha: usar o da sessao rotacionaria
  // o token de quem esta prestes a nao ter mais conta.
  const conferencia = await senhaConfere(usuario.email, senha);
  if (conferencia === 'indisponivel') {
    return erro(RECADO_INDISPONIVEL);
  }
  if (conferencia === 'errada') {
    return erro('A senha está incorreta.');
  }

  const supabase = await clienteServidor();
  const admin = clienteAdmin();

  // A foto sai antes do usuario. Depois de apagar a conta, a sessao nao existe
  // mais e a policy do storage nao reconheceria o dono do arquivo — a imagem
  // ficaria orfa no bucket para sempre.
  const { data: perfil } = await supabase
    .from('profiles')
    .select('foto_caminho')
    .eq('id', usuario.id)
    .maybeSingle();

  if (perfil?.foto_caminho) {
    await supabase.storage.from('avatares').remove([perfil.foto_caminho]);
  }

  // Carimba a anonimizacao ANTES de apagar. Depois, o `on delete set null` ja
  // teria cortado o vinculo e nao haveria mais como achar quais pedidos eram
  // desta pessoa.
  await admin
    .from('orders')
    .update({ anonimizado_em: new Date().toISOString() })
    .eq('user_id', usuario.id);

  // Encerra TODAS as sessoes antes de apagar (#309). O cascade do deleteUser
  // tambem levaria as sessoes, mas por baixo do Auth; assim e o proprio Auth
  // que revoga os refresh tokens de cada aparelho, e outro aparelho logado nao
  // segue renovando token durante a exclusao. Se nao deu para encerrar, nada e
  // apagado: a pessoa continua com a conta e tenta de novo.
  const { error: erroSaida } = await supabase.auth.signOut({ scope: 'global' });
  if (erroSaida) {
    return erro('Não consegui excluir a conta agora. Tente de novo em instantes.');
  }

  // Apagar o usuario leva junto, por cascade: o perfil, as sessoes e os
  // refresh tokens. Os pedidos ficam, com user_id nulo.
  const { error } = await admin.auth.admin.deleteUser(usuario.id);

  if (error) {
    // A sessao ja foi encerrada logo acima: para tentar de novo, a pessoa
    // precisa entrar outra vez.
    return erro('Não consegui excluir a conta agora. Entre de novo e tente em instantes.');
  }

  // Os cookies desta sessao nao apontam mais para nada, mas continuam no
  // navegador; limpar evita a proxima pagina tentar usar um token morto.
  const jar = await cookies();
  for (const cookie of jar.getAll()) {
    if (cookie.name.startsWith('sb-')) jar.delete(cookie.name);
  }
  jar.delete(COOKIE_LEMBRAR);
  jar.delete(COOKIE_RECUPERACAO);

  redirect('/?conta=excluida');
}
