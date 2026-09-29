'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { senhaVazada } from '@/lib/conta/senha-servidor';
import { esquemaCriarConta } from '@/lib/esquemas';
import { ipDoRequest, limita } from '@/lib/rate-limit';
import { CAMPO_DA_ISCA, CAMPO_DO_DESAFIO, desafioConfere, pareceRobo, RECUSA } from '@/lib/robo';
import { CONTA } from '@/lib/rotas';
import { urlDeRetorno } from '@/lib/site-url';
import { clienteDeAuth } from '@/lib/supabase/servidor';
import type { EstadoCriarConta } from './estado';

/**
 * Cadastro (Issue #30).
 *
 * O que esta acao NUNCA diz: se o e-mail ja tem conta. Cadastro que responde
 * "esse e-mail ja existe" e um oraculo — o atacante roda uma lista e sai com
 * quem e cliente. Por isso a resposta de sucesso e a mesma nos dois casos:
 * "enviamos um link para X". O Supabase colabora: com confirmacao ligada, o
 * signUp de e-mail repetido devolve um usuario de mentira e nao manda nada.
 *
 * O aceite da politica e carimbado AQUI, com o relogio do servidor, e vai na
 * metadata do signup — a trigger do banco grava em profiles na mesma
 * transacao que cria a conta. Nao ha conta sem aceite registrado.
 */

/** Por IP, por hora: script criando conta em serie. */
const POR_IP = { maximo: 5, janelaMs: 60 * 60 * 1000 };
/** Por e-mail: nao mandar tres links por minuto para a mesma caixa. */
const POR_EMAIL = { maximo: 3, janelaMs: 60 * 60 * 1000 };

const MENSAGENS: Record<string, string> = {
  nome: 'Diga como quer ser chamado (2 a 80 letras).',
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
    nome: form.get('nome'),
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

  const { nome, email, senha } = dados.data;

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
      data: { nome, termos_aceitos_em: new Date().toISOString() },
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
