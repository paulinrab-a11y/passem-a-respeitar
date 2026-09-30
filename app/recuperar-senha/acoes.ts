'use server';

import { headers } from 'next/headers';
import { esquemaEmail } from '@/lib/esquemas';
import { ipDoRequest, limita } from '@/lib/rate-limit';
import { CAMPO_DA_ISCA, CAMPO_DO_DESAFIO, desafioConfere, pareceRobo, RECUSA } from '@/lib/robo';
import { urlDeRetorno } from '@/lib/site-url';
import { clienteDeAuth } from '@/lib/supabase/servidor';
import type { EstadoRecuperar } from './estado';

/**
 * Pedido de recuperacao de senha (Issue #32).
 *
 * A resposta e a MESMA exista a conta ou nao — inclusive quando o Supabase
 * devolve erro. "Nao achei esse e-mail" e um oraculo de cadastro; "se esse
 * e-mail tiver conta, mandamos um link" nao entrega nada. A unica resposta
 * diferente e a do limite, e ela tambem nao diz nada sobre a conta. A da
 * protecao contra bot (#28) e igual nisso: fala do envio, nao do e-mail.
 *
 * O token do link e do Supabase: uso unico, vence em uma hora, e pedir um
 * novo invalida o anterior. O que se controla aqui e quantas vezes se pede.
 */

/** Por IP: varredura de e-mails a partir de uma origem. */
const POR_IP = { maximo: 5, janelaMs: 60 * 60 * 1000 };
/** Por e-mail: nao encher a caixa de alguem que nao pediu. */
const POR_EMAIL = { maximo: 3, janelaMs: 60 * 60 * 1000 };

const DESTINO_DO_LINK = '/redefinir-senha';

export async function recuperarSenha(
  anterior: EstadoRecuperar,
  form: FormData
): Promise<EstadoRecuperar> {
  const tentativa = anterior.tentativa + 1;

  // Antes de tudo (#28): o que da para recusar sem gastar tentativa do limite.
  const desafio = form.get(CAMPO_DO_DESAFIO);
  if (await pareceRobo({ isca: form.get(CAMPO_DA_ISCA), desafio })) {
    return { erro: RECUSA, campo: null, enviado: false, tentativa };
  }

  const dados = esquemaEmail.safeParse({ email: form.get('email') });
  if (!dados.success) {
    return { erro: 'Confira o e-mail.', campo: 'email', enviado: false, tentativa };
  }
  const { email } = dados.data;

  const cabecalhos = await headers();
  const ip = ipDoRequest(cabecalhos);
  const cotaIp = await limita(`recuperar:ip:${ip}`, POR_IP.maximo, POR_IP.janelaMs);
  const cotaEmail = await limita(`recuperar:email:${email}`, POR_EMAIL.maximo, POR_EMAIL.janelaMs);
  if (!cotaIp.permitido || !cotaEmail.permitido) {
    return {
      erro: 'Muitos pedidos. Tente de novo mais tarde.',
      campo: null,
      enviado: false,
      tentativa,
    };
  }

  // Depois do limite: a conferencia e uma chamada para fora.
  if (!(await desafioConfere(desafio, 'recuperar-senha', ip))) {
    return { erro: RECUSA, campo: null, enviado: false, tentativa };
  }

  const supabase = await clienteDeAuth(false);
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: urlDeRetorno(cabecalhos, DESTINO_DO_LINK),
  });

  // O erro, se houver, fica aqui dentro de proposito: qualquer diferenca na
  // resposta contaria se o e-mail existe.
  return { erro: null, campo: null, enviado: true, tentativa };
}
