'use server';

import { revalidatePath } from 'next/cache';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { EstadoCodigo, EstadoReenvio } from '@/app/_ui/estado-do-codigo';
import {
  CODIGO_INCOMPLETO,
  CODIGO_INVALIDO,
  cabeConferencia,
  codigoDaContaConfere,
} from '@/lib/conta/codigo';
import { esquemaCodigo, esquemaNome } from '@/lib/esquemas';
import { ipDoRequest, limita } from '@/lib/rate-limit';
import { CAMPO_DA_ISCA, iscaPreenchida, RECUSA } from '@/lib/robo';
import { CONTA } from '@/lib/rotas';
import { COOKIE_LEMBRAR } from '@/lib/supabase/cookies';
import { clienteDeAuth, clienteServidor, usuarioDaSessao } from '@/lib/supabase/servidor';
import type { EstadoNome } from './estado';

/**
 * Reenvio do e-mail de verificacao: 3 por hora.
 *
 * O limite aqui nao e contra o usuario, e contra o dominio do site: caixa de
 * entrada que recebe dez e-mails iguais marca como spam, e a reputacao
 * queimada atinge todo mundo, nao so quem clicou demais.
 */
const VERIFICACAO = { maximo: 3, janelaMs: 60 * 60 * 1000 };

const SESSAO_EXPIROU = 'Sua sessão expirou. Entre de novo.';

/** O codigo do e-mail de cadastro: so o formato, porque o e-mail vem da sessao. */
const esquemaSoCodigo = esquemaCodigo.pick({ codigo: true });

export async function salvarNome(anterior: EstadoNome, form: FormData): Promise<EstadoNome> {
  const tentativa = anterior.tentativa + 1;

  const usuario = await usuarioDaSessao();
  if (!usuario) {
    return { recado: { tom: 'erro', texto: SESSAO_EXPIROU }, tentativa };
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

/**
 * O aviso de e-mail nao verificado em /conta (#30, #260).
 *
 * Com a configuracao de hoje ele nao aparece: o Supabase recusa o login de
 * conta nao confirmada, e todo caminho que cria sessao tambem confirma o
 * e-mail. Fica como defesa — se a configuracao mudar, quem chegar aqui sem
 * confirmar tem onde digitar o codigo, em vez de receber um codigo sem campo,
 * que era o que o botao antigo fazia.
 *
 * Nas duas acoes o e-mail vem da SESSAO, nunca do formulario. Aceitar um
 * e-mail de fora transformaria o site em mandador de codigo para qualquer
 * endereco, e em conferidor de codigo de qualquer conta.
 */
export async function reenviarVerificacao(
  anterior: EstadoReenvio,
  _form: FormData
): Promise<EstadoReenvio> {
  const tentativa = anterior.tentativa + 1;
  const falha = (texto: string) => ({
    erro: texto,
    aviso: null,
    reenviadoEm: anterior.reenviadoEm,
    tentativa,
  });

  const usuario = await usuarioDaSessao();
  if (!usuario?.email) return falha(SESSAO_EXPIROU);

  if (usuario.email_confirmed_at) {
    // A tela estava velha: outra aba ja confirmou. Recarregar tira o aviso.
    revalidatePath(CONTA);
    return { erro: null, aviso: 'Seu e-mail já está verificado.', reenviadoEm: null, tentativa };
  }

  const cota = await limita(`verificacao:${usuario.id}`, VERIFICACAO.maximo, VERIFICACAO.janelaMs);
  if (!cota.permitido) return falha('Já enviei alguns. Confira o spam e tente mais tarde.');

  const supabase = await clienteServidor();
  const { error } = await supabase.auth.resend({ type: 'signup', email: usuario.email });
  if (error) return falha('Não consegui enviar agora.');

  return {
    erro: null,
    aviso: 'Enviei um código. Confira a caixa de entrada e o spam.',
    reenviadoEm: Date.now(),
    tentativa,
  };
}

/**
 * Confere o codigo digitado no aviso de /conta (#260). Sem `redirect`: a
 * pessoa ja esta onde queria, e o `revalidatePath` redesenha a pagina sem o
 * aviso, com o selo de verificado. O checkout le o e-mail confirmado do
 * Supabase a cada pedido, entao libera na hora, sem sair e entrar.
 */
export async function confirmarCodigoDaConta(
  anterior: EstadoCodigo,
  form: FormData
): Promise<EstadoCodigo> {
  const tentativa = anterior.tentativa + 1;
  const falha = (texto: string) => ({ erro: texto, tentativa });

  // So a isca, como na tela publica do codigo: o codigo ja e um segredo que
  // chegou por e-mail, e aqui ainda ha sessao.
  if (iscaPreenchida(form.get(CAMPO_DA_ISCA))) return falha(RECUSA);

  const usuario = await usuarioDaSessao();
  if (!usuario?.email) return falha(SESSAO_EXPIROU);

  if (usuario.email_confirmed_at) {
    revalidatePath(CONTA);
    return { erro: null, tentativa };
  }

  const dados = esquemaSoCodigo.safeParse({
    codigo: String(form.get('codigo') ?? '').replace(/\D/g, ''),
  });
  if (!dados.success) return falha(CODIGO_INCOMPLETO);

  // Por conta, e nao por e-mail: e a conta da sessao que esta sendo chutada.
  const ip = ipDoRequest(await headers());
  if (!(await cabeConferencia(`conta:${usuario.id}`, ip))) {
    return falha('Muitas tentativas. Espere alguns minutos e peça um código novo.');
  }

  if (!(await codigoDaContaConfere(usuario.email, dados.data.codigo))) {
    return falha(CODIGO_INVALIDO);
  }

  revalidatePath(CONTA);
  return { erro: null, tentativa };
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
