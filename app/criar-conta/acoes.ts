'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
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
import { clienteDeAuth } from '@/lib/supabase/servidor';
import type { EstadoCodigo, EstadoCriarConta, EstadoReenvio } from './estado';

/**
 * Cadastro (Issue #30).
 *
 * O que esta acao NUNCA diz: se o e-mail ja tem conta. Cadastro que responde
 * "esse e-mail ja existe" e um oraculo — o atacante roda uma lista e sai com
 * quem e cliente. Por isso a resposta de sucesso e a mesma nos dois casos:
 * "enviamos um codigo para X". O Supabase colabora: com confirmacao ligada, o
 * signUp de e-mail ja confirmado devolve um usuario de mentira e nao manda
 * nada. O de conta ainda nao confirmada manda um codigo novo, e e esse o
 * caminho de volta de quem saiu da tela do codigo (#227).
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
 * Confirmar o cadastro pelo codigo de seis digitos (#224).
 *
 * Desde a #227 o e-mail traz so o codigo, sem link: confirmar e sempre por
 * aqui, e termina em sessao em cookie e /conta. O `verifyOtp` roda NO
 * SERVIDOR, com o cliente que grava cookie — o navegador nunca fala com o
 * Supabase direto.
 *
 * O que esta acao nunca diz: se o e-mail tem conta. E-mail repetido no
 * cadastro nao recebe codigo nenhum, e qualquer codigo digitado da "invalido
 * ou vencido" — a mesma resposta de um codigo errado para conta nova.
 */

/** Por IP, em dez minutos: chute de codigo em serie. */
const CODIGO_POR_IP = { maximo: 20, janelaMs: 10 * 60 * 1000 };
/** Por e-mail: dez tentativas por codigo e muito; o Supabase ainda limita por baixo. */
const CODIGO_POR_EMAIL = { maximo: 10, janelaMs: 10 * 60 * 1000 };

const CODIGO_INVALIDO =
  'Código inválido ou vencido. Confira os seis dígitos ou peça um novo abaixo.';

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
  });
  if (!dados.success) return falha('Digite os seis dígitos do código.');
  const { email, codigo } = dados.data;

  const ip = ipDoRequest(await headers());
  const cotaIp = await limita(`codigo:ip:${ip}`, CODIGO_POR_IP.maximo, CODIGO_POR_IP.janelaMs);
  const cotaEmail = await limita(
    `codigo:email:${email}`,
    CODIGO_POR_EMAIL.maximo,
    CODIGO_POR_EMAIL.janelaMs
  );
  if (!cotaIp.permitido || !cotaEmail.permitido) {
    return falha('Muitas tentativas. Espere alguns minutos e peça um código novo.');
  }

  const supabase = await clienteDeAuth(false);
  const { error } = await supabase.auth.verifyOtp({ email, token: codigo, type: 'email' });
  if (error) {
    // Codigo errado, vencido e e-mail sem cadastro pendente dao a mesma
    // frase: distinguir seria contar quem esta no meio do cadastro.
    return falha(CODIGO_INVALIDO);
  }

  redirect(destinoSeguro(form.get('next')?.toString()));
}

/**
 * Pedir outro codigo (#224). Manda e-mail, entao e a acao cara: isca, desafio
 * da Cloudflare e dois limites. O Supabase recusa reenvio antes de 60 s, e a
 * tela ja nem oferece o botao antes disso.
 */
const REENVIO_POR_IP = { maximo: 5, janelaMs: 60 * 60 * 1000 };
const REENVIO_POR_EMAIL = { maximo: 3, janelaMs: 60 * 60 * 1000 };

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
  const cotaIp = await limita(`reenvio:ip:${ip}`, REENVIO_POR_IP.maximo, REENVIO_POR_IP.janelaMs);
  const cotaEmail = await limita(
    `reenvio:email:${email}`,
    REENVIO_POR_EMAIL.maximo,
    REENVIO_POR_EMAIL.janelaMs
  );
  if (!cotaIp.permitido || !cotaEmail.permitido) {
    return falha('Muitos pedidos. Tente de novo mais tarde.');
  }

  if (!(await desafioConfere(desafio, 'reenviar-codigo', ip))) return falha(RECUSA);

  const supabase = await clienteDeAuth(false);
  const { error } = await supabase.auth.resend({
    type: 'signup',
    email,
    options: { emailRedirectTo: urlDeRetorno(cabecalhos, CONTA) },
  });
  if (error) {
    // Dois casos distintos para a pessoa, um so para o atacante: o limite
    // de 60 s do Supabase e a unica mensagem que muda. Conta ja confirmada
    // tambem cai em erro, e recebe o recado generico — nao e para saber.
    if (/rate|limit|60 seconds|security purposes/i.test(error.message)) {
      return falha('Espere um minuto para pedir outro código.');
    }
  }

  return {
    erro: null,
    aviso: REENVIADO,
    reenviadoEm: Date.now(),
    tentativa: anterior.tentativa + 1,
  };
}
