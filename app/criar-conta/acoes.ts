'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { EstadoCodigo, EstadoReenvio } from '@/app/_ui/estado-do-codigo';
import {
  CODIGO_INCOMPLETO,
  CODIGO_INVALIDO,
  cabeConferencia,
  cabeReenvioDoEmail,
  cabeReenvioDoIp,
  confirmaCadastro,
  mandaCodigo,
} from '@/lib/conta/codigo';
import { senhaVazada } from '@/lib/conta/senha-servidor';
import {
  esquemaCodigo,
  esquemaConfirmarCadastro,
  esquemaCriarConta,
  esquemaEmail,
} from '@/lib/esquemas';
import { ipDoRequest, limita } from '@/lib/rate-limit';
import {
  CAMPO_DA_ISCA,
  CAMPO_DO_DESAFIO,
  desafioConfere,
  iscaPreenchida,
  pareceRobo,
  RECUSA,
} from '@/lib/robo';
import { CONTA, destinoSeguro } from '@/lib/rotas';
import { urlDeRetorno } from '@/lib/site-url';
import { COOKIE_LEMBRAR, opcoesDoLembrar } from '@/lib/supabase/cookies';
import { clienteDeAuth } from '@/lib/supabase/servidor';
import type { EstadoCriarConta } from './estado';

/**
 * Cadastro (Issue #30).
 *
 * O que esta acao NUNCA diz: se o e-mail ja tem conta. Cadastro que responde
 * "esse e-mail ja existe" e um oraculo — o atacante roda uma lista e sai com
 * quem e cliente. Por isso a resposta de sucesso e a mesma nos dois casos:
 * "enviamos um codigo para X". O Supabase colabora: com confirmacao ligada, o
 * signUp de e-mail ja confirmado devolve um usuario de mentira e nao manda
 * nada. O de conta ainda nao confirmada manda um codigo novo, mas descarta a
 * senha digitada agora: a conta pendente fica com a do primeiro cadastro.
 * Quem confirma pela tela do cadastro grava a senha nova no codigo
 * (`confirmarCadastro`, #284); quem saiu da tela volta pelo login com a
 * senha (#260).
 *
 * O aceite da politica e carimbado AQUI, com o relogio do servidor, e vai na
 * metadata do signup — a trigger do banco grava em profiles na mesma
 * transacao que cria a conta. Nao ha conta sem aceite registrado.
 */

/** Por IP, por hora: script criando conta em serie. */
const POR_IP = { maximo: 5, janelaMs: 60 * 60 * 1000 };
/** Por e-mail: nao mandar mais de tres codigos por hora para a mesma caixa. */
const POR_EMAIL = { maximo: 3, janelaMs: 60 * 60 * 1000 };

const MENSAGENS: Record<string, string> = {
  email: 'Confira o e-mail.',
  senha: 'A senha precisa de pelo menos 8 caracteres.',
  confirmacao: 'A confirmação não bate com a senha.',
  aceite: 'Para criar a conta, é preciso aceitar a política de privacidade.',
};

function erro(anterior: EstadoCriarConta, texto: string, campo: string | null = null) {
  return { erro: texto, campo, enviadoPara: null, tentativa: anterior.tentativa + 1 };
}

export async function criarConta(
  anterior: EstadoCriarConta,
  form: FormData
): Promise<EstadoCriarConta> {
  // Antes de tudo (#28): o que da para recusar sem gastar tentativa do limite.
  const desafio = form.get(CAMPO_DO_DESAFIO);
  if (await pareceRobo({ isca: form.get(CAMPO_DA_ISCA), desafio })) {
    return erro(anterior, RECUSA);
  }

  const dados = esquemaCriarConta.safeParse({
    email: form.get('email'),
    senha: form.get('senha'),
    confirmacao: form.get('confirmacao'),
    // Checkbox nao enviado nao aparece no FormData. Qualquer coisa que nao
    // seja "on" vira false — e false nao passa no schema.
    aceite: form.get('aceite') === 'on',
  });

  if (!dados.success) {
    const campo = String(dados.error.issues[0]?.path[0] ?? '');
    return erro(anterior, MENSAGENS[campo] ?? 'Confira os dados.', campo || null);
  }

  const { email, senha } = dados.data;

  const cabecalhos = await headers();
  const ip = ipDoRequest(cabecalhos);
  const cotaIp = await limita(`criar:ip:${ip}`, POR_IP.maximo, POR_IP.janelaMs);
  const cotaEmail = await limita(`criar:email:${email}`, POR_EMAIL.maximo, POR_EMAIL.janelaMs);
  if (!cotaIp.permitido || !cotaEmail.permitido) {
    return erro(anterior, 'Muitas tentativas. Tente de novo mais tarde.');
  }

  // Depois do limite: a conferencia e uma chamada para fora. E antes da
  // consulta de senha vazada, que e outra.
  if (!(await desafioConfere(desafio, 'criar-conta', ip))) {
    return erro(anterior, RECUSA);
  }

  if (await senhaVazada(senha)) {
    return erro(
      anterior,
      'Essa senha aparece em vazamentos conhecidos. Escolha outra — não precisa ser complicada, precisa ser sua.',
      'senha'
    );
  }

  const supabase = await clienteDeAuth(false);
  const { data, error } = await supabase.auth.signUp({
    email,
    password: senha,
    options: {
      // Sem nome (#207): o perfil nasce sem ele, e a pessoa poe em Conta se
      // quiser. O aceite continua carimbado aqui, com o relogio do servidor.
      data: { termos_aceitos_em: new Date().toISOString() },
      emailRedirectTo: urlDeRetorno(cabecalhos, CONTA),
    },
  });

  if (error) {
    // Nada aqui distingue "e-mail existe" de "caiu a rede": o Supabase nao
    // devolve erro para e-mail repetido, e o que sobra e falha de verdade.
    return erro(anterior, 'Não consegui criar a conta agora. Tente de novo em instantes.');
  }

  // Confirmacao de e-mail desligada no projeto: a sessao ja veio. Nao e o
  // caso hoje, mas se um dia for, a pessoa entra direto em vez de esperar um
  // e-mail que nao vai chegar.
  if (data.session) redirect(CONTA);

  return { erro: null, campo: null, enviadoPara: email, tentativa: anterior.tentativa + 1 };
}

const MUITAS_CONFERENCIAS = 'Muitas tentativas. Espere alguns minutos e peça um código novo.';
/** So com o formulario adulterado: o cadastro conferiu a senha antes do codigo. */
const SENHA_NAO_VEIO = 'A senha não veio junto com o código. Use Trocar e-mail e envie de novo.';
const SENHA_VAZADA_NO_CODIGO =
  'Essa senha aparece em vazamentos conhecidos. Use Trocar e-mail e escolha outra.';

/**
 * Confirmar pelo codigo de oito digitos o e-mail de quem chegou pelo LOGIN
 * (#224, #260).
 *
 * Desde a #227 o e-mail traz so o codigo, sem link: confirmar termina em
 * sessao em cookie e no destino. O `verifyOtp` roda NO SERVIDOR, com o
 * cliente que grava cookie — o navegador nunca fala com o Supabase direto.
 *
 * So a tela do login de conta nao confirmada usa esta acao; a do cadastro
 * usa `confirmarCadastro`, que grava a senha (#284). Aqui a senha fica como
 * esta de proposito: quem chegou pelo login acabou de provar que a conhece,
 * entao ela ja e de quem confirma. Do login vem o "manter conectado" e o
 * `next` de quem ia para o checkout; a sessao nasce como nasceria no login.
 *
 * O que esta acao nunca diz: se o e-mail tem conta. Qualquer codigo errado da
 * "invalido ou vencido", tenha o e-mail cadastro pendente ou nao.
 */
export async function confirmarCodigo(
  anterior: EstadoCodigo,
  form: FormData
): Promise<EstadoCodigo> {
  const falha = (texto: string) => ({ erro: texto, tentativa: anterior.tentativa + 1 });

  // So a isca (#28), sem desafio: o codigo ja e um segredo que chegou por
  // e-mail, e o Supabase limita as tentativas por conta propria. Desafio aqui
  // seria atrito a mais na hora em que a pessoa esta com o e-mail do lado.
  if (iscaPreenchida(form.get(CAMPO_DA_ISCA))) return falha(RECUSA);

  const dados = esquemaCodigo.safeParse({
    email: form.get('email'),
    codigo: String(form.get('codigo') ?? '').replace(/\D/g, ''),
    lembrar: form.get('lembrar') === '1',
  });
  if (!dados.success) return falha(CODIGO_INCOMPLETO);
  const { email, codigo, lembrar } = dados.data;

  const ip = ipDoRequest(await headers());
  if (!(await cabeConferencia(`email:${email}`, ip))) return falha(MUITAS_CONFERENCIAS);

  const supabase = await clienteDeAuth(lembrar);
  const { error } = await supabase.auth.verifyOtp({ email, token: codigo, type: 'email' });
  if (error) return falha(CODIGO_INVALIDO);

  // Como no login: o middleware le esta escolha a cada renovacao do token.
  // Sem ela, a sessao de quem marcou "manter conectado" morreria ao fechar o
  // navegador.
  (await cookies()).set(COOKIE_LEMBRAR, lembrar ? '1' : '0', opcoesDoLembrar(lembrar));

  redirect(destinoSeguro(form.get('next')?.toString()));
}

/**
 * Confirmar pela tela do cadastro, gravando a senha que a pessoa acabou de
 * escolher (#224, #284). O porque esta em `confirmaCadastro`, em
 * lib/conta/codigo.ts: sem isto, quem cadastrou o e-mail antes, com outra
 * senha, ficava com a conta que a pessoa confirmou.
 *
 * A senha volta do formulario do cadastro, que ainda a tem na memoria: o
 * navegador a junta ao envio na hora (./Codigo.tsx). Nao fica em campo
 * oculto, cookie nem armazenamento do navegador, e esta acao nao a devolve
 * nem a registra. Passa pelas mesmas regras do cadastro
 * (`esquemaConfirmarCadastro`).
 *
 * Tudo que pode recusar vem ANTES do `verifyOtp`, porque ele gasta o codigo
 * e confirma o e-mail: recusar depois deixaria a conta confirmada com a senha
 * de quem cadastrou primeiro. Por isso a senha vazada e conferida de novo
 * aqui — com o HIBP fora do ar no cadastro ela passou (falha aberta), e esta
 * e a ultima porta antes de ela valer.
 *
 * O que esta acao nunca diz: se o e-mail tem conta. Os erros do codigo sao
 * os de `confirmarCodigo`, os da senha dependem so do que veio no formulario,
 * e os desfechos sem sessao so aparecem depois de um codigo certo, que so a
 * dona da caixa tem.
 */
export async function confirmarCadastro(
  anterior: EstadoCodigo,
  form: FormData
): Promise<EstadoCodigo> {
  const tentativa = anterior.tentativa + 1;
  const falha = (texto: string) => ({ erro: texto, tentativa });

  // So a isca, sem desafio, como em `confirmarCodigo`.
  if (iscaPreenchida(form.get(CAMPO_DA_ISCA))) return falha(RECUSA);

  const dados = esquemaConfirmarCadastro.safeParse({
    email: form.get('email'),
    codigo: String(form.get('codigo') ?? '').replace(/\D/g, ''),
    senha: form.get('senha'),
    confirmacao: form.get('confirmacao'),
  });
  if (!dados.success) {
    const campos = dados.error.issues.map((i) => i.path[0]);
    const daSenha = campos.every((c) => c === 'senha' || c === 'confirmacao');
    return falha(daSenha ? SENHA_NAO_VEIO : CODIGO_INCOMPLETO);
  }
  const { email, codigo, senha } = dados.data;

  // O mesmo contador do login: alternar entre as duas telas nao dobra os
  // chutes.
  const ip = ipDoRequest(await headers());
  if (!(await cabeConferencia(`email:${email}`, ip))) return falha(MUITAS_CONFERENCIAS);

  // Depois do limite, porque e uma ida a rede.
  if (await senhaVazada(senha)) return falha(SENHA_VAZADA_NO_CODIGO);

  const confirmacao = await confirmaCadastro(email, codigo, senha);
  if (confirmacao.resultado === 'invalido') return falha(CODIGO_INVALIDO);
  if (confirmacao.resultado === 'sem-senha')
    return { erro: null, tentativa, desfecho: 'sem-senha' };

  // A sessao so chega ao cookie agora, com a senha ja gravada. `false`: o
  // cadastro nao tem "manter conectado", e sem a caixa vale o lado seguro.
  const supabase = await clienteDeAuth(false);
  const { error } = await supabase.auth.setSession(confirmacao.sessao);
  // E-mail confirmado e senha gravada; so a sessao nao veio. O login resolve,
  // e o codigo ja foi gasto: repetir daria "inválido ou vencido". A sessao que
  // nasceu no codigo fica sem dono e aparece em "Aparelhos conectados" ate
  // ser encerrada — so acontece com o Supabase caindo entre duas chamadas.
  if (error) return { erro: null, tentativa, desfecho: 'entrar' };

  // Como no login: o middleware le esta escolha a cada renovacao do token.
  (await cookies()).set(COOKIE_LEMBRAR, '0', opcoesDoLembrar(false));

  redirect(CONTA);
}

/**
 * Pedir outro codigo (#224). Manda e-mail, entao e a acao cara: isca, desafio
 * da Cloudflare e dois limites — os mesmos do login de conta nao confirmada,
 * que tambem manda codigo (#260). O do IP vem antes do desafio e o do e-mail
 * depois: ver `cabeReenvioDoIp` em lib/conta/codigo.ts. O Supabase recusa
 * reenvio dentro do intervalo minimo, e a tela ja nem oferece o botao antes
 * de 60 s.
 */
const REENVIADO = 'Se o e-mail for válido, enviamos outro código. Vale o mais recente.';
const MUITOS_PEDIDOS = 'Muitos pedidos. Tente de novo mais tarde.';

export async function reenviarCodigo(
  anterior: EstadoReenvio,
  form: FormData
): Promise<EstadoReenvio> {
  const falha = (texto: string) => ({
    erro: texto,
    aviso: null,
    reenviadoEm: anterior.reenviadoEm,
    tentativa: anterior.tentativa + 1,
  });

  const desafio = form.get(CAMPO_DO_DESAFIO);
  if (await pareceRobo({ isca: form.get(CAMPO_DA_ISCA), desafio })) return falha(RECUSA);

  const dados = esquemaEmail.safeParse({ email: form.get('email') });
  if (!dados.success) return falha('Confira o e-mail.');
  const { email } = dados.data;

  const cabecalhos = await headers();
  const ip = ipDoRequest(cabecalhos);
  if (!(await cabeReenvioDoIp(ip))) return falha(MUITOS_PEDIDOS);

  if (!(await desafioConfere(desafio, 'reenviar-codigo', ip))) return falha(RECUSA);

  // So agora, com o token conferido: a cota do e-mail e a mesma do codigo que
  // o login manda, e quem gasta precisa ter passado pelo desafio (#260).
  if (!(await cabeReenvioDoEmail(email))) return falha(MUITOS_PEDIDOS);

  // Sem olhar o resultado (#260): o unico erro que sobrava para a pessoa era
  // o intervalo minimo do Supabase, e ele so acontece com cadastro pendente.
  // Responder "espere um minuto" ali contava, a quem pedisse dois seguidos,
  // quem esta no meio do cadastro. A contagem da tela ja segura quem e
  // honesto, e o codigo anterior continua valendo quando o Supabase recusa.
  const supabase = await clienteDeAuth(false);
  await mandaCodigo(supabase.auth, email, cabecalhos);

  return {
    erro: null,
    aviso: REENVIADO,
    reenviadoEm: Date.now(),
    tentativa: anterior.tentativa + 1,
  };
}
