'use server';

import { createClient } from '@supabase/supabase-js';
import { senhaVazada } from '@/lib/conta/senha-servidor';
import { esquemaTrocarSenha } from '@/lib/esquemas';
import { limita } from '@/lib/rate-limit';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '@/lib/supabase/env';
import { clienteDeAuth, usuarioDaSessao } from '@/lib/supabase/servidor';
import type { EstadoSenha } from './estado';

/** Cinco tentativas por hora. O alvo aqui e quem sentou no computador alheio. */
const LIMITE = { maximo: 5, janelaMs: 60 * 60 * 1000 };

function erro(texto: string, tentativa: number): EstadoSenha {
  return { recado: { tom: 'erro', texto }, tentativa };
}

/**
 * Confere a senha atual sem encostar na sessao.
 *
 * `signInWithPassword` no client de sessao rotacionaria o token e
 * reescreveria os cookies — a pessoa acabaria com uma sessao nova so por ter
 * digitado a senha certa num formulario de conferencia.
 *
 * Este client e descartavel: `persistSession: false`, sem cookies, sem
 * storage. Ele existe por tres linhas e some.
 */
async function senhaAtualConfere(email: string, senha: string) {
  const avulso = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error } = await avulso.auth.signInWithPassword({ email, password: senha });
  return !error;
}

export async function trocarSenha(anterior: EstadoSenha, form: FormData): Promise<EstadoSenha> {
  const tentativa = anterior.tentativa + 1;

  const usuario = await usuarioDaSessao();
  if (!usuario?.email) {
    return erro('Sua sessão expirou. Entre de novo.', tentativa);
  }

  const cota = limita(`senha:${usuario.id}`, LIMITE.maximo, LIMITE.janelaMs);
  if (!cota.permitido) {
    return erro('Muitas tentativas. Tente de novo mais tarde.', tentativa);
  }

  const dados = esquemaTrocarSenha.safeParse({
    atual: form.get('atual'),
    nova: form.get('nova'),
    confirmacao: form.get('confirmacao'),
  });

  if (!dados.success) {
    // Mensagens distintas aqui nao vazam nada: quem chegou ate esta tela ja
    // provou quem e. Generico so faria a pessoa adivinhar o que errou.
    const campo = dados.error.issues[0]?.path[0];
    if (campo === 'confirmacao') return erro('A confirmação não bate com a nova senha.', tentativa);
    if (campo === 'nova') {
      const nova = String(form.get('nova') ?? '');
      if (nova === String(form.get('atual') ?? '')) {
        return erro('A nova senha é igual à atual.', tentativa);
      }
      return erro('A nova senha precisa de pelo menos 8 caracteres.', tentativa);
    }
    return erro('Preencha os três campos.', tentativa);
  }

  const { atual, nova } = dados.data;

  if (!(await senhaAtualConfere(usuario.email, atual))) {
    return erro('A senha atual está incorreta.', tentativa);
  }

  if (await senhaVazada(nova)) {
    return erro(
      'Essa senha aparece em vazamentos conhecidos. Escolha outra — não precisa ser complicada, precisa ser sua.',
      tentativa
    );
  }

  const supabase = await clienteDeAuth(true);
  const { error } = await supabase.auth.updateUser({ password: nova });

  if (error) {
    return erro('Não consegui trocar a senha agora.', tentativa);
  }

  // `others`: derruba as outras sessoes e mantem esta. E o ponto da troca de
  // senha — quem tinha acesso perde, e quem trocou continua onde estava, sem
  // ser jogado para a tela de login logo depois de fazer a coisa certa.
  await supabase.auth.signOut({ scope: 'others' });

  return {
    recado: {
      tom: 'ok',
      texto: 'Senha trocada. As sessões abertas em outros aparelhos foram encerradas.',
    },
    tentativa,
  };
}
