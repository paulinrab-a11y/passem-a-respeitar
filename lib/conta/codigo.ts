import 'server-only';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { CODIGO_DIGITOS } from '@/lib/esquemas';
import { limita } from '@/lib/rate-limit';
import { CONTA } from '@/lib/rotas';
import { urlDeRetorno } from '@/lib/site-url';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '@/lib/supabase/env';
import { cabecalhosDeOrigem } from '@/lib/supabase/servidor';

/**
 * O codigo de confirmacao do cadastro, do lado do servidor (#224, #260).
 *
 * Tres telas pedem e conferem o mesmo codigo: o cadastro, o login de conta
 * ainda nao confirmada e o aviso de /conta. Os limites moram aqui, e nao em
 * cada acao, porque o limitador do Upstash separa o contador pelo par
 * (maximo, janela): o login com um numero e o botao de reenviar com outro
 * nao dividiriam a cota, e alternar entre os dois furaria o limite.
 *
 * Fora de arquivo `'use server'` de proposito: la, toda funcao exportada vira
 * endpoint publico, e qualquer um chamaria estas com o e-mail que quisesse.
 */

/** Por IP, por hora: script pedindo codigo para uma lista de e-mails. */
const REENVIO_POR_IP = { maximo: 5, janelaMs: 60 * 60 * 1000 };
/** Por e-mail: caixa que recebe dez codigos iguais marca o dominio como spam. */
const REENVIO_POR_EMAIL = { maximo: 3, janelaMs: 60 * 60 * 1000 };

/** Por IP, em dez minutos: chute de codigo em serie. */
const CODIGO_POR_IP = { maximo: 20, janelaMs: 10 * 60 * 1000 };
/** Por alvo: dez tentativas por codigo e muito; o Supabase ainda limita por baixo. */
const CODIGO_POR_ALVO = { maximo: 10, janelaMs: 10 * 60 * 1000 };

/**
 * Codigo errado, vencido e e-mail sem cadastro pendente dao a mesma frase:
 * distinguir seria contar quem esta no meio do cadastro.
 */
export const CODIGO_INVALIDO = `Código inválido ou vencido. Confira os ${CODIGO_DIGITOS} dígitos ou peça um novo abaixo.`;

export const CODIGO_INCOMPLETO = `Digite os ${CODIGO_DIGITOS} dígitos do código.`;

/**
 * Os dois limites de quem pede codigo, em funcoes separadas porque o botao de
 * reenviar os confere em momentos diferentes. O do IP vem antes do desafio da
 * Cloudflare: rajada nao pode virar uma chamada para fora por request. O do
 * e-mail so depois dele. Antes do desafio, qualquer texto passa por token, e
 * um script trocando de IP gastaria a cota de um e-mail alheio sem mandar
 * nada — e, com ela, o codigo que o login manda a quem acertou a senha
 * (#260).
 */
export async function cabeReenvioDoIp(ip: string) {
  const cota = await limita(`reenvio:ip:${ip}`, REENVIO_POR_IP.maximo, REENVIO_POR_IP.janelaMs);
  return cota.permitido;
}

export async function cabeReenvioDoEmail(email: string) {
  const cota = await limita(
    `reenvio:email:${email}`,
    REENVIO_POR_EMAIL.maximo,
    REENVIO_POR_EMAIL.janelaMs
  );
  return cota.permitido;
}

/**
 * Os dois de uma vez, para quem ja passou pelo desafio: o login, que so
 * chega aqui com a senha certa. Os dois contadores andam sempre, como nos
 * outros limites do site: parar no primeiro deixaria o segundo sem registro
 * da tentativa.
 */
export async function cabeReenvio(email: string, ip: string) {
  const porIp = await cabeReenvioDoIp(ip);
  const porEmail = await cabeReenvioDoEmail(email);
  return porIp && porEmail;
}

/**
 * Ainda cabe conferir um codigo? `alvo` e quem esta sendo chutado:
 * `email:<e-mail>` na tela publica, `conta:<id>` em /conta, onde o e-mail
 * vem da sessao.
 */
export async function cabeConferencia(alvo: `email:${string}` | `conta:${string}`, ip: string) {
  const porIp = await limita(`codigo:ip:${ip}`, CODIGO_POR_IP.maximo, CODIGO_POR_IP.janelaMs);
  const porAlvo = await limita(`codigo:${alvo}`, CODIGO_POR_ALVO.maximo, CODIGO_POR_ALVO.janelaMs);
  return porIp.permitido && porAlvo.permitido;
}

type Auth = Pick<SupabaseClient['auth'], 'resend'>;

/**
 * Pede ao Supabase outro e-mail de cadastro, com codigo novo, e diz se ele
 * aceitou o pedido.
 *
 * Para e-mail desconhecido e conta ja confirmada o Supabase responde 200 sem
 * mandar nada; o erro que sobra para conta pendente e o intervalo minimo entre
 * e-mails (429). Por isso o botao de reenviar, que responde a qualquer um,
 * ignora a resposta: repassar o 429 era contar a quem pede dois codigos
 * seguidos que ali existe um cadastro pendente (#260). So o login, que ja
 * conferiu a senha, usa a resposta, para nao dizer "enviamos" quando nada
 * saiu. No 429 o codigo anterior continua valendo: um reenvio que da certo
 * invalida o anterior, um recusado nao.
 */
export async function mandaCodigo(auth: Auth, email: string, cabecalhos: Headers) {
  const { error } = await auth.resend({
    type: 'signup',
    email,
    options: { emailRedirectTo: urlDeRetorno(cabecalhos, CONTA) },
  });
  return !error;
}

/**
 * Confere o codigo de quem ja tem sessao (o aviso de /conta), sem mexer
 * nela.
 *
 * O `verifyOtp` cria uma sessao nova no Supabase. Gravar essa sessao no
 * cookie trocaria a de quem pediu, e a velha ficaria em "Aparelhos
 * conectados" como um aparelho que a pessoa nao reconhece — o mesmo motivo
 * do client descartavel da conferencia de senha (#244). Aqui ela nasce num
 * client que nao grava nada e e encerrada logo depois: o que a acao quer e
 * o e-mail confirmado, nao outra sessao.
 */
export async function codigoDaContaConfere(email: string, codigo: string) {
  const avulso = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: await cabecalhosDeOrigem() },
  });

  const { error } = await avulso.auth.verifyOtp({ email, token: codigo, type: 'email' });
  if (error) return false;

  // `local`: so a sessao que acabou de nascer. O erro daqui nao muda a
  // resposta: o codigo conferiu e o e-mail ja esta confirmado.
  await avulso.auth.signOut({ scope: 'local' });
  return true;
}
