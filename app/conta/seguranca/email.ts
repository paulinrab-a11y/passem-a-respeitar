'use server';

import { revalidatePath } from 'next/cache';
import { cookies, headers } from 'next/headers';
import { senhaConfere } from '@/lib/conta/reautenticacao';
import { esquemaTrocarEmail } from '@/lib/esquemas';
import { ipDoRequest, limita } from '@/lib/rate-limit';
import { urlDeRetorno } from '@/lib/site-url';
import { COOKIE_LEMBRAR } from '@/lib/supabase/cookies';
import { clienteDeAuth, clienteServidor, usuarioDaSessao } from '@/lib/supabase/servidor';
import type { EstadoCancelamento, EstadoEmail } from './estado-email';

/**
 * Troca de e-mail (Issue #36).
 *
 * Trocar o e-mail e trocar o dono da recuperacao de senha: quem controla o
 * endereco controla a conta. Por isso tres travas, e nenhuma depende da tela:
 *
 *   1. Senha conferida AGORA. Mais forte que a janela de 15 minutos da #40:
 *      sessao aberta em computador alheio nao troca o e-mail de ninguem.
 *   2. O e-mail so muda depois de confirmado nos DOIS enderecos. E a
 *      configuracao "secure email change" do Supabase, conferida no projeto:
 *      o endereco antigo recebe o pedido e precisa aprovar. Quem sequestrou a
 *      sessao nao tem a caixa antiga, e a troca nao acontece.
 *   3. Ate as duas confirmacoes, nada muda: o login continua no antigo.
 *
 * O aviso no endereco antigo e o proprio pedido de confirmacao. O caminho
 * para voltar atras e nao confirmar — ou cancelar aqui, o que mata os links.
 */

const SEGURANCA = '/conta/seguranca';

/** Tres pedidos por hora por conta: cada um manda dois e-mails. */
const POR_CONTA = { maximo: 3, janelaMs: 60 * 60 * 1000 };
/** Por IP, para o limite nao ser contornado trocando de conta. */
const POR_IP = { maximo: 6, janelaMs: 60 * 60 * 1000 };

/**
 * A mesma resposta para "pedido criado" e para "endereco ja tem conta". Dizer
 * qual dos dois seria contar a quem perguntou quem e cliente.
 */
const ENVIADO =
  'Se o endereço puder ser usado, mandamos dois links: um para ele e um para o e-mail atual. A troca só vale depois das duas confirmações.';

function erro(texto: string, tentativa: number, campo: EstadoEmail['campo'] = null): EstadoEmail {
  return { recado: { tom: 'erro', texto }, campo, tentativa };
}

export async function trocarEmail(anterior: EstadoEmail, form: FormData): Promise<EstadoEmail> {
  const tentativa = anterior.tentativa + 1;

  const usuario = await usuarioDaSessao();
  if (!usuario?.email) {
    return erro('Sua sessão expirou. Entre de novo.', tentativa);
  }

  const cabecalhos = await headers();
  const cotaConta = await limita(`email:${usuario.id}`, POR_CONTA.maximo, POR_CONTA.janelaMs);
  const cotaIp = await limita(
    `email:ip:${ipDoRequest(cabecalhos)}`,
    POR_IP.maximo,
    POR_IP.janelaMs
  );
  if (!cotaConta.permitido || !cotaIp.permitido) {
    return erro('Muitas tentativas. Tente de novo mais tarde.', tentativa);
  }

  const dados = esquemaTrocarEmail.safeParse({
    email: form.get('email'),
    senha: form.get('senha'),
  });

  if (!dados.success) {
    const campo = dados.error.issues[0]?.path[0] === 'senha' ? 'senha' : 'email';
    return erro(
      campo === 'senha' ? 'Digite sua senha.' : 'Confira o e-mail novo.',
      tentativa,
      campo
    );
  }

  const { email, senha } = dados.data;

  if (email === usuario.email.toLowerCase()) {
    return erro('Esse já é o e-mail da conta.', tentativa, 'email');
  }

  // Client descartavel: confere sem rotacionar a sessao de quem esta pedindo.
  if (!(await senhaConfere(usuario.email, senha))) {
    return erro('A senha está incorreta.', tentativa, 'senha');
  }

  const lembrar = (await cookies()).get(COOKIE_LEMBRAR)?.value === '1';
  const supabase = await clienteDeAuth(lembrar);
  const { error } = await supabase.auth.updateUser(
    { email },
    { emailRedirectTo: urlDeRetorno(cabecalhos, SEGURANCA) }
  );

  if (error && error.code !== 'email_exists') {
    if (error.code === 'over_email_send_rate_limit' || error.status === 429) {
      return erro('Acabamos de mandar um e-mail. Espere um minuto e tente de novo.', tentativa);
    }
    return erro('Não consegui pedir a troca agora. Tente de novo.', tentativa);
  }

  revalidatePath(SEGURANCA);
  return { recado: { tom: 'ok', texto: ENVIADO }, campo: null, tentativa };
}

/**
 * Desiste da troca pendente. Os links que ja sairam deixam de valer.
 *
 * Sem senha: cancelar nao da nada a ninguem. O pior que quem sentou no
 * computador alheio consegue aqui e impedir uma troca, e o dono pede outra.
 */
export async function cancelarTrocaDeEmail(
  _anterior: EstadoCancelamento,
  _form: FormData
): Promise<EstadoCancelamento> {
  const usuario = await usuarioDaSessao();
  if (!usuario) {
    return { recado: { tom: 'erro', texto: 'Sua sessão expirou. Entre de novo.' } };
  }

  const cota = await limita(`email:cancelar:${usuario.id}`, 10, 60 * 60 * 1000);
  if (!cota.permitido) {
    return { recado: { tom: 'erro', texto: 'Muitas tentativas. Tente de novo mais tarde.' } };
  }

  const supabase = await clienteServidor();
  const { data, error } = await supabase.rpc('cancela_troca_de_email');

  if (error) {
    return { recado: { tom: 'erro', texto: 'Não consegui cancelar agora.' } };
  }

  revalidatePath(SEGURANCA);
  return {
    recado: {
      tom: 'ok',
      texto: data
        ? 'Troca cancelada. Os links enviados não valem mais.'
        : 'Não havia troca pendente.',
    },
  };
}
