import 'server-only';

import { randomBytes } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { MARCA_SEM_SENHA } from '@/lib/conta/sem-senha';
import { CODIGO_DIGITOS } from '@/lib/esquemas';
import { limita } from '@/lib/rate-limit';
import { CONTA } from '@/lib/rotas';
import { urlDeRetorno } from '@/lib/site-url';
import { clienteAdmin } from '@/lib/supabase/admin';
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
 * Manda o codigo de entrar sem senha (#387), criando a conta se o e-mail nao
 * tiver nenhuma.
 *
 * O Supabase escolhe o e-mail pelo estado da conta: conta confirmada recebe o
 * modelo "Magic link or OTP"; e-mail sem conta, ou com conta que nunca
 * confirmou, recebe o "Confirm sign up". Os dois trazem o mesmo tipo de
 * codigo de oito digitos, conferido do mesmo jeito.
 *
 * O aceite vai na metadata, como no cadastro (`criarConta`): a trigger
 * `cria_profile_no_signup` carimba a hora do banco na conta que nascer aqui.
 * Para conta que ja existe o Supabase ignora a metadata, e o aceite que vale
 * e o do cadastro dela.
 *
 * Num client que nao grava cookie: pedir o codigo nao mexe na sessao de
 * ninguem. A resposta diz se o Supabase aceitou o pedido; quem responde a
 * pessoa nao a usa, pelo mesmo motivo do reenvio (`mandaCodigo`).
 */
export async function mandaCodigoDeEntrada(email: string) {
  const avulso = await clienteAvulso();
  const { error } = await avulso.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: true,
      data: { termos_aceitos_em: new Date().toISOString() },
    },
  });
  return !error;
}

/**
 * Diferenca maxima entre a confirmacao do e-mail e a entrada para dizer que
 * as duas aconteceram nesta conferencia. O Supabase grava as duas na mesma
 * chamada, com milissegundos entre elas (medido no Supabase local: 13 ms); a
 * conta confirmada antes tem a confirmacao la atras.
 */
const MESMA_CONFERENCIA_MS = 2000;

/**
 * A conta acabou de ser confirmada por este codigo? Os dois relogios sao do
 * Supabase, que devolve a entrada desta conferencia ja gravada. Sem uma das
 * datas, a resposta e sim: na duvida, a senha que existia nao e de confianca.
 */
function confirmouAgora(usuario: {
  email_confirmed_at?: string | null;
  last_sign_in_at?: string | null;
}) {
  const confirmado = usuario.email_confirmed_at
    ? Date.parse(usuario.email_confirmed_at)
    : Number.NaN;
  const entrou = usuario.last_sign_in_at ? Date.parse(usuario.last_sign_in_at) : Number.NaN;
  if (!Number.isFinite(confirmado) || !Number.isFinite(entrou)) return true;
  return entrou - confirmado < MESMA_CONFERENCIA_MS;
}

/** Senha que ninguem conhece, para tirar da conta a que veio de outra pessoa. */
function senhaDescartavel() {
  return randomBytes(48).toString('base64url');
}

/**
 * A chave secreta mexendo na conta, sem e-mail de aviso. Chave secreta
 * ausente lanca; aqui isso e so mais um jeito de falhar.
 */
async function atualizaPelaChave(
  id: string,
  atributos: { password?: string; app_metadata?: Record<string, unknown> }
): Promise<{ error: Error | null }> {
  try {
    const { error } = await clienteAdmin().auth.admin.updateUserById(id, atributos);
    return { error };
  } catch (e) {
    return { error: e instanceof Error ? e : new Error(String(e)) };
  }
}

/**
 * Poe na conta uma senha que ninguem conhece, e marca a conta como sem senha
 * (#389) na mesma chamada: a senha aleatoria e a marca entram juntas ou nao
 * entram. A marca e o que abre "Criar senha" em Seguranca.
 */
function trocaSenhaSemAviso(id: string, senha: string) {
  return atualizaPelaChave(id, { password: senha, app_metadata: { [MARCA_SEM_SENHA]: true } });
}

/**
 * Grava a senha que a pessoa criou em Seguranca (#389) e tira a marca de
 * conta sem senha, numa chamada so. So depois de o codigo do e-mail conferir.
 *
 * Pela chave secreta, e nao pelo `updateUser` da sessao, por dois motivos: o
 * Supabase mandaria "Sua senha foi trocada" a quem nunca teve senha, e, com
 * "Secure password change" ligado no painel, recusaria a troca sem um nonce
 * que este fluxo nao tem — o codigo que acabou de conferir ja e a prova.
 *
 * `null` apaga a chave do `app_metadata`: o Supabase mescla o que chega com
 * o que existe, e chave com valor nulo sai.
 *
 * A troca pela chave secreta derruba todas as sessoes da conta (medido na
 * #387), a de quem pediu inclusive. Quem chama abre uma nova com a senha.
 */
export function gravaSenhaCriada(id: string, senha: string) {
  return atualizaPelaChave(id, { password: senha, app_metadata: { [MARCA_SEM_SENHA]: null } });
}

/**
 * Tira a marca de conta sem senha de quem redefiniu a senha pela recuperacao
 * (#389). Melhor esforco: se falhar, a pessoa ve "Criar senha" em vez de
 * "Trocar senha", e criar outra pelo codigo continua funcionando.
 */
export async function esqueceContaSemSenha(id: string) {
  const { error } = await atualizaPelaChave(id, { app_metadata: { [MARCA_SEM_SENHA]: null } });
  return !error;
}

/**
 * Manda o codigo de oito digitos a uma conta que ja existe (#389), sem criar
 * nenhuma: o e-mail vem da sessao, e `shouldCreateUser: false` e a segunda
 * trava. Conta confirmada recebe o modelo "Magic link or OTP", o mesmo da
 * entrada por codigo. Num client sem cookie: pedir o codigo nao mexe na
 * sessao de quem pediu.
 *
 * Aqui a resposta do Supabase pode chegar a tela: quem pede ja provou quem e
 * pela sessao, e o e-mail e o dela.
 */
export async function mandaCodigoDaConta(email: string) {
  const avulso = await clienteAvulso();
  const { error } = await avulso.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false },
  });
  return !error;
}

/**
 * O que sobra de entrar pelo codigo (#387):
 *
 * - `invalido`: o codigo nao conferiu, e nada mudou na conta.
 * - `recuperar`: o e-mail ficou confirmado, mas nao deu para tirar da conta a
 *   senha que ela tinha. Nenhuma sessao ficou viva; o caminho e criar uma
 *   senha pela recuperacao.
 * - `pronto`: a sessao vai para quem chamou gravar no cookie.
 */
export type EntradaPorCodigo =
  | { resultado: 'invalido' }
  | { resultado: 'recuperar' }
  | { resultado: 'pronto'; sessao: { access_token: string; refresh_token: string } };

/**
 * Confere o codigo de entrar sem senha (#387).
 *
 * Pre-sequestro de conta (#284): alguem cadastra o e-mail de outra pessoa com
 * uma senha DELE e nao confirma. Se a dona do e-mail entra pelo codigo, o
 * Supabase confirma aquela conta pendente e a senha dele continua valendo.
 * Por isso, quando ESTE codigo e o que confirmou a conta, a senha que ela
 * tinha e trocada por uma que ninguem conhece, e as outras sessoes caem. Ela
 * so podia ter vindo de quem nao provou a posse do e-mail: quem cadastrou e
 * nao confirmou, ou o proprio Supabase, que cria a conta do codigo com uma
 * senha aleatoria. Quem quiser senha cria uma depois, em Seguranca (#389):
 * a troca marca a conta como sem senha.
 *
 * Conta que ja era confirmada fica como esta: a senha dela foi escolhida por
 * quem provou a posse do e-mail, no cadastro ou na recuperacao.
 *
 * Tudo num client que nao grava cookie, como em `confirmaCadastro`: a sessao
 * so sai daqui quando a conta ja nao tem senha de mais ninguem.
 */
export async function entraPorCodigo(email: string, codigo: string): Promise<EntradaPorCodigo> {
  const avulso = await clienteAvulso();

  const { data, error } = await avulso.auth.verifyOtp({ email, token: codigo, type: 'email' });
  if (error) return { resultado: 'invalido' };
  // Na pratica o Supabase sempre devolve os dois. Sem sessao nao ha o que
  // gravar no cookie, e o codigo ja foi gasto: o caminho e pedir outro.
  if (!data.session || !data.user) return { resultado: 'invalido' };

  if (confirmouAgora(data.user)) {
    // Pela chave secreta, e nao pelo `updateUser` da sessao: por ali o
    // Supabase manda "Sua senha foi trocada", e quem acabou de criar a conta
    // pelo codigo nunca teve senha nenhuma para ver trocada. A troca e so
    // desta conta, a que o codigo acabou de provar ser de quem digitou.
    //
    // A troca pela chave secreta derruba TODAS as sessoes da conta, a que o
    // codigo acabou de abrir inclusive (medido no Supabase local). A sessao
    // que vai para o cookie nasce depois, com a senha que so este servidor
    // conheceu e que nao sai daqui.
    const senha = senhaDescartavel();
    const { error: erroDaSenha } = await trocaSenhaSemAviso(data.user.id, senha);
    if (erroDaSenha) {
      // `global`: a que acabou de nascer e qualquer outra. A conta fica
      // confirmada, mas ninguem entra nela com a senha antiga por esta porta.
      await avulso.auth.signOut({ scope: 'global' });
      return { resultado: 'recuperar' };
    }

    const nova = await avulso.auth.signInWithPassword({ email, password: senha });
    // A conta ja esta limpa: sem a sessao nova, o caminho e a recuperacao,
    // que da a pessoa uma senha dela.
    if (nova.error || !nova.data.session) return { resultado: 'recuperar' };
    // `others`: sobra so esta. A troca ja derrubou as outras; isto e a
    // segunda trava, caso o Supabase deixe de derrubar um dia.
    await avulso.auth.signOut({ scope: 'others' });

    const { access_token, refresh_token } = nova.data.session;
    return { resultado: 'pronto', sessao: { access_token, refresh_token } };
  }

  const { access_token, refresh_token } = data.session;
  return { resultado: 'pronto', sessao: { access_token, refresh_token } };
}

/**
 * Client que nao grava cookie: a sessao que nascer nele so vive na memoria
 * desta chamada. Leva o navegador e o IP de quem pediu, para a sessao nascer
 * com eles e o limite por IP do Supabase contar contra quem digitou (#244).
 */
async function clienteAvulso() {
  return createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: await cabecalhosDeOrigem() },
  });
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
  const avulso = await clienteAvulso();

  const { error } = await avulso.auth.verifyOtp({ email, token: codigo, type: 'email' });
  if (error) return false;

  // `local`: so a sessao que acabou de nascer. O erro daqui nao muda a
  // resposta: o codigo conferiu e o e-mail ja esta confirmado.
  await avulso.auth.signOut({ scope: 'local' });
  return true;
}

/**
 * O que sobra de conferir o codigo do cadastro gravando a senha (#284):
 *
 * - `invalido`: o codigo nao conferiu, e nada mudou na conta.
 * - `sem-senha`: o e-mail ficou confirmado, mas a senha escolhida nao foi
 *   gravada. Nenhuma sessao ficou viva.
 * - `pronto`: e-mail confirmado, senha gravada, as outras sessoes
 *   derrubadas. A sessao vai para quem chamou gravar no cookie.
 */
export type ConfirmacaoDoCadastro =
  | { resultado: 'invalido' }
  | { resultado: 'sem-senha' }
  | { resultado: 'pronto'; sessao: { access_token: string; refresh_token: string } };

/**
 * Confere o codigo da tela do cadastro e grava, na conta, a senha que a
 * pessoa acabou de escolher (#284).
 *
 * Pre-sequestro de conta: alguem cadastra o e-mail de outra pessoa com uma
 * senha DELE e nao confirma. Quando a dona do e-mail se cadastra, o
 * Supabase nao mexe na conta pendente — so manda um codigo novo — e a senha
 * que ela digitou e descartada. Confirmando pelo codigo, a conta ficava dela
 * no e-mail e dele na senha. Por isso, depois do `verifyOtp`, a senha da
 * tela e gravada com a sessao recem-nascida, e as outras sessoes caem.
 *
 * Tudo num client que nao grava cookie, e a sessao so sai daqui quando a
 * senha ja e a da pessoa. Se a gravacao falhar, a sessao e encerrada antes de
 * chegar ao navegador: entrar numa conta cuja senha pode ser de outro seria
 * pior do que pedir uma senha nova pela recuperacao.
 *
 * `same_password` nao e falha, e o caso comum: sem ninguem no meio, a senha
 * da conta pendente ja e a que a pessoa escolheu, e o Supabase recusa trocar
 * uma senha por ela mesma.
 */
export async function confirmaCadastro(
  email: string,
  codigo: string,
  senha: string
): Promise<ConfirmacaoDoCadastro> {
  const avulso = await clienteAvulso();

  const { data, error } = await avulso.auth.verifyOtp({ email, token: codigo, type: 'email' });
  if (error) return { resultado: 'invalido' };
  // O codigo conferiu e o e-mail esta confirmado, mas sem sessao nao ha com
  // o que gravar a senha. Na pratica o Supabase sempre devolve uma.
  if (!data.session) return { resultado: 'sem-senha' };

  const { error: erroDaSenha } = await avulso.auth.updateUser({ password: senha });
  if (erroDaSenha && erroDaSenha.code !== 'same_password') {
    // `global`: a que acabou de nascer e qualquer uma que tenha entrado com
    // a senha antiga entre o codigo e esta linha. Melhor esforco: com o
    // Supabase fora do ar, a sessao daqui morre com esta chamada mesmo, sem
    // ter chegado ao cookie.
    await avulso.auth.signOut({ scope: 'global' });
    return { resultado: 'sem-senha' };
  }

  // `others`: mantem esta, que vai para o cookie, e derruba o resto. Como na
  // troca de senha, o erro daqui nao desfaz o que ja foi gravado.
  await avulso.auth.signOut({ scope: 'others' });

  const { access_token, refresh_token } = data.session;
  return { resultado: 'pronto', sessao: { access_token, refresh_token } };
}
