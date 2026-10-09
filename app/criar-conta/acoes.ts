'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { EstadoCodigo, EstadoReenvio } from '@/app/_ui/estado-do-codigo';
import {
  CODIGO_INCOMPLETO,
  CODIGO_INVALIDO,
  cabeConferencia,
  cabeReenvio,
  mandaCodigo,
} from '@/lib/conta/codigo';
import { senhaVazada } from '@/lib/conta/senha-servidor';
import { esquemaCodigo, esquemaCriarConta, esquemaEmail } from '@/lib/esquemas';
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
 * senha digitada agora: vale a do primeiro cadastro. Por isso o caminho de
 * volta de quem saiu da tela do codigo e o login com a senha (#260), e nao
 * cadastrar de novo.
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

/**
 * Confirmar o cadastro pelo codigo de oito digitos (#224).
 *
 * Desde a #227 o e-mail traz so o codigo, sem link: confirmar e sempre por
 * aqui, e termina em sessao em cookie e no destino. O `verifyOtp` roda NO
 * SERVIDOR, com o cliente que grava cookie — o navegador nunca fala com o
 * Supabase direto.
 *
 * Serve a duas telas: a do cadastro e a do login de conta nao confirmada
 * (#260). Da segunda vem o "manter conectado" e o `next` de quem ia para o
 * checkout; a sessao nasce como nasceria no login.
 *
 * O que esta acao nunca diz: se o e-mail tem conta. E-mail repetido no
 * cadastro nao recebe codigo nenhum, e qualquer codigo digitado da "invalido
 * ou vencido" — a mesma resposta de um codigo errado para conta nova.
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
  if (!(await cabeConferencia(`email:${email}`, ip))) {
    return falha('Muitas tentativas. Espere alguns minutos e peça um código novo.');
  }

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
 * Pedir outro codigo (#224). Manda e-mail, entao e a acao cara: isca, desafio
 * da Cloudflare e dois limites — os mesmos do login de conta nao confirmada,
 * que tambem manda codigo (#260). O Supabase recusa reenvio dentro do
 * intervalo minimo, e a tela ja nem oferece o botao antes de 60 s.
 */
const REENVIADO = 'Se o e-mail for válido, enviamos outro código. Vale o mais recente.';

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
  if (!(await cabeReenvio(email, ip))) {
    return falha('Muitos pedidos. Tente de novo mais tarde.');
  }

  if (!(await desafioConfere(desafio, 'reenviar-codigo', ip))) return falha(RECUSA);

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
