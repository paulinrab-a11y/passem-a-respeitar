'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { esquemaNome } from '@/lib/esquemas';
import { limita } from '@/lib/rate-limit';
import { COOKIE_LEMBRAR } from '@/lib/supabase/cookies';
import { clienteDeAuth, clienteServidor, usuarioDaSessao } from '@/lib/supabase/servidor';
import type { EstadoNome, EstadoVerificacao } from './estado';

/**
 * Reenvio do e-mail de verificacao: 3 por hora.
 *
 * O limite aqui nao e contra o usuario, e contra o dominio do site: caixa de
 * entrada que recebe dez e-mails iguais marca como spam, e a reputacao
 * queimada atinge todo mundo, nao so quem clicou demais.
 */
const VERIFICACAO = { maximo: 3, janelaMs: 60 * 60 * 1000 };

export async function salvarNome(anterior: EstadoNome, form: FormData): Promise<EstadoNome> {
  const tentativa = anterior.tentativa + 1;

  const usuario = await usuarioDaSessao();
  if (!usuario) {
    return { recado: { tom: 'erro', texto: 'Sua sessão expirou. Entre de novo.' }, tentativa };
  }

  const dados = esquemaNome.safeParse({ nome: form.get('nome') });
  if (!dados.success) {
    return {
      recado: { tom: 'erro', texto: 'Use entre 2 e 80 caracteres.' },
      tentativa,
    };
  }

  const supabase = await clienteServidor();

  // `update` com um campo so, e `eq` pelo id da sessao. O grant por coluna e a
  // RLS ja barrariam o resto; o objeto enxuto aqui e a terceira vez que a
  // mesma coisa e dita, e a unica que um leitor deste arquivo enxerga.
  const { error } = await supabase
    .from('profiles')
    .update({ nome: dados.data.nome })
    .eq('id', usuario.id);

  if (error) {
    return { recado: { tom: 'erro', texto: 'Não consegui salvar agora.' }, tentativa };
  }

  // Sem isto o nome antigo continuaria na tela ate a proxima navegacao dura.
  revalidatePath('/conta');
  return { recado: { tom: 'ok', texto: 'Nome salvo.' }, tentativa };
}

export async function reenviarVerificacao(
  anterior: EstadoVerificacao,
  _form: FormData
): Promise<EstadoVerificacao> {
  const tentativa = anterior.tentativa + 1;

  const usuario = await usuarioDaSessao();
  if (!usuario?.email) {
    return { recado: { tom: 'erro', texto: 'Sua sessão expirou. Entre de novo.' }, tentativa };
  }

  if (usuario.email_confirmed_at) {
    return { recado: { tom: 'ok', texto: 'Seu e-mail já está verificado.' }, tentativa };
  }

  const cota = await limita(`verificacao:${usuario.id}`, VERIFICACAO.maximo, VERIFICACAO.janelaMs);
  if (!cota.permitido) {
    return {
      recado: { tom: 'erro', texto: 'Já enviei alguns. Confira o spam e tente mais tarde.' },
      tentativa,
    };
  }

  const supabase = await clienteServidor();
  const { error } = await supabase.auth.resend({ type: 'signup', email: usuario.email });

  if (error) {
    return { recado: { tom: 'erro', texto: 'Não consegui enviar agora.' }, tentativa };
  }

  return {
    recado: { tom: 'ok', texto: 'Enviei de novo. Confira a caixa de entrada e o spam.' },
    tentativa,
  };
}

/**
 * Sair.
 *
 * `signOut` do Supabase faz duas coisas: revoga o refresh token no servidor e
 * manda apagar os cookies. A primeira e a que importa — sem ela, "sair" seria
 * so limpar o navegador, e quem tivesse copiado o token continuaria entrando
 * com ele ate expirar.
 *
 * `scope: 'global'` derruba todas as sessoes da conta, nao so esta. E o que
 * alguem clica depois de perceber que esqueceu o computador aberto em algum
 * lugar, entao precisa valer para o outro lugar, nao para este.
 */
async function encerra(escopo: 'local' | 'global') {
  // O `lembrar` aqui nao importa: o que este client vai fazer e mandar apagar
  // cookie, e apagar nao tem validade.
  const supabase = await clienteDeAuth(false);
  await supabase.auth.signOut({ scope: escopo });

  // O Supabase apaga os cookies dele; o par_lembrar e nosso. Deixar para tras
  // faria a proxima sessao herdar a escolha de quem usou o navegador antes.
  (await cookies()).delete(COOKIE_LEMBRAR);

  // Fora de try/catch: `redirect` funciona lancando.
  redirect('/');
}

export async function sair() {
  await encerra('local');
}

export async function sairDeTodos() {
  await encerra('global');
}
