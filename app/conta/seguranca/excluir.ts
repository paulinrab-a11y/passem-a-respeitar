'use server';

import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { limita } from '@/lib/rate-limit';
import { clienteAdmin } from '@/lib/supabase/admin';
import { COOKIE_LEMBRAR } from '@/lib/supabase/cookies';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '@/lib/supabase/env';
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

  const cota = limita(`excluir:${usuario.id}`, LIMITE.maximo, LIMITE.janelaMs);
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
  const avulso = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: erroSenha } = await avulso.auth.signInWithPassword({
    email: usuario.email,
    password: senha,
  });

  if (erroSenha) {
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

  // Apagar o usuario leva junto, por cascade: o perfil, as sessoes e os
  // refresh tokens. Os pedidos ficam, com user_id nulo.
  const { error } = await admin.auth.admin.deleteUser(usuario.id);

  if (error) {
    return erro('Não consegui excluir a conta agora. Tente de novo em instantes.');
  }

  // Os cookies desta sessao nao apontam mais para nada, mas continuam no
  // navegador; limpar evita a proxima pagina tentar usar um token morto.
  const jar = await cookies();
  for (const cookie of jar.getAll()) {
    if (cookie.name.startsWith('sb-')) jar.delete(cookie.name);
  }
  jar.delete(COOKIE_LEMBRAR);

  redirect('/?conta=excluida');
}
