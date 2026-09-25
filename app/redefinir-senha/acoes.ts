'use server';

import { redirect } from 'next/navigation';
import { senhaVazada } from '@/lib/conta/senha-servidor';
import { esquemaRedefinirSenha } from '@/lib/esquemas';
import { limita } from '@/lib/rate-limit';
import { CONTA } from '@/lib/rotas';
import { clienteDeAuth, usuarioDaSessao } from '@/lib/supabase/servidor';
import type { EstadoRedefinir } from './estado';

/**
 * Redefinicao de senha (Issue #32).
 *
 * Quem chega aqui provou quem e pelo link do e-mail: o callback trocou o
 * token por uma sessao. Sem sessao nao ha o que redefinir — e a tela nem
 * mostra o formulario. A acao confere de novo, porque tela e sugestao.
 *
 * Depois de trocar, as OUTRAS sessoes caem (`scope: 'others'`): se alguem
 * estava dentro da conta, perde o acesso agora; quem redefiniu continua.
 */

/** Cinco por hora por conta: o alvo e script tentando adivinhar por aqui. */
const LIMITE = { maximo: 5, janelaMs: 60 * 60 * 1000 };

const SEM_SESSAO: EstadoRedefinir = {
  erro: 'Esse link não vale mais. Peça outro.',
  campo: null,
  tentativa: 0,
};

export async function redefinirSenha(
  anterior: EstadoRedefinir,
  form: FormData
): Promise<EstadoRedefinir> {
  const tentativa = anterior.tentativa + 1;

  const usuario = await usuarioDaSessao();
  if (!usuario) return { ...SEM_SESSAO, tentativa };

  const cota = await limita(`redefinir:${usuario.id}`, LIMITE.maximo, LIMITE.janelaMs);
  if (!cota.permitido) {
    return { erro: 'Muitas tentativas. Peça um link novo mais tarde.', campo: null, tentativa };
  }

  const dados = esquemaRedefinirSenha.safeParse({
    nova: form.get('nova'),
    confirmacao: form.get('confirmacao'),
  });
  if (!dados.success) {
    const campo = String(dados.error.issues[0]?.path[0] ?? '');
    return {
      erro:
        campo === 'confirmacao'
          ? 'A confirmação não bate com a nova senha.'
          : 'A senha precisa de pelo menos 8 caracteres.',
      campo: campo || null,
      tentativa,
    };
  }

  const { nova } = dados.data;

  if (await senhaVazada(nova)) {
    return {
      erro: 'Essa senha aparece em vazamentos conhecidos. Escolha outra — não precisa ser complicada, precisa ser sua.',
      campo: 'nova',
      tentativa,
    };
  }

  // `lembrar: false`: a sessao que nasceu do link e para redefinir, e morre
  // com o navegador. Quem quiser ficar conectado entra de novo e marca.
  const supabase = await clienteDeAuth(false);
  const { error } = await supabase.auth.updateUser({ password: nova });
  if (error) {
    return { erro: 'Não consegui trocar a senha agora. Tente de novo.', campo: null, tentativa };
  }

  await supabase.auth.signOut({ scope: 'others' });

  redirect(CONTA);
}
