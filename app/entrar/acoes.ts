'use server';

import * as Sentry from '@sentry/nextjs';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { esquemaEntrar } from '@/lib/esquemas';
import { ipDoRequest, limita } from '@/lib/rate-limit';
import { destinoSeguro } from '@/lib/rotas';
import { COOKIE_LEMBRAR, opcoesDoLembrar } from '@/lib/supabase/cookies';
import { clienteDeAuth } from '@/lib/supabase/servidor';
import type { EstadoEntrar } from './estado';

/**
 * Mensagem unica para e-mail inexistente, senha errada, conta nao confirmada e
 * formato invalido.
 *
 * Qualquer diferenca vira oraculo de cadastro: o atacante roda uma lista de
 * e-mails, separa os que respondem "senha incorreta" dos que respondem
 * "e-mail nao encontrado", e sai dali com a lista de quem tem conta. Isso vale
 * dinheiro em phishing, e o site entrega de graca.
 *
 * O aviso sobre confirmacao aparece SEMPRE, inclusive quando o e-mail nem
 * existe. Ajuda quem acabou de se cadastrar sem contar nada sobre quem e
 * cadastrado.
 */
const ERRO_GENERICO =
  'E-mail ou senha incorretos. Se você acabou de criar a conta, confirme o link que enviamos por e-mail.';

/** Por IP: segura varredura de e-mails a partir de uma origem. */
const POR_IP = { maximo: 20, janelaMs: 15 * 60 * 1000 };

/**
 * Por e-mail: segura forca bruta contra UMA conta, que e o ataque que o limite
 * por IP nao pega — botnet troca de IP a cada tentativa, mas o alvo continua
 * o mesmo.
 */
const POR_EMAIL = { maximo: 5, janelaMs: 15 * 60 * 1000 };

/**
 * Piso de tempo de resposta, em ms (#23).
 *
 * A mensagem ja e a mesma para e-mail inexistente e senha errada; o TEMPO
 * ainda podia contar: o provedor devolve mais rapido quando nem acha a conta,
 * porque nao ha hash para comparar. Quem mede milissegundos enumera contas
 * do mesmo jeito. O piso cobre os dois casos com o mesmo tempo minimo.
 *
 * Lido por request, e nao no topo do modulo, para o teste poder zerar sem
 * esperar de verdade.
 */
const pisoMs = () => Number(process.env.LOGIN_PISO_MS ?? 300);

async function segura(inicio: number) {
  const resto = inicio + pisoMs() - Date.now();
  if (resto > 0) await new Promise((r) => setTimeout(r, resto));
}

export async function entrar(anterior: EstadoEntrar, form: FormData): Promise<EstadoEntrar> {
  const tentativa = anterior.tentativa + 1;

  const dados = esquemaEntrar.safeParse({
    email: form.get('email'),
    senha: form.get('senha'),
    lembrar: form.get('lembrar') === 'on',
  });

  // Entrada malformada responde igual a credencial errada. Dizer "e-mail
  // invalido" aqui separaria os dois casos para quem estiver medindo.
  if (!dados.success) {
    return { erro: ERRO_GENERICO, tentativa };
  }

  const { email, senha, lembrar } = dados.data;

  const ip = ipDoRequest(await headers());
  const cotaIp = limita(`entrar:ip:${ip}`, POR_IP.maximo, POR_IP.janelaMs);
  const cotaEmail = limita(`entrar:email:${email}`, POR_EMAIL.maximo, POR_EMAIL.janelaMs);

  if (!cotaIp.permitido || !cotaEmail.permitido) {
    // O sinal para o alerta de "pico de falha de login" (#8): bater no
    // limite e forca bruta em andamento. Vai so a dimensao — por IP ou por
    // e-mail —, nunca o IP nem o e-mail.
    Sentry.captureMessage('login: limite de tentativas atingido', {
      level: 'warning',
      tags: { por: cotaEmail.permitido ? 'ip' : 'email' },
    });

    const esperar = Math.max(cotaIp.esperarS, cotaEmail.esperarS);
    const minutos = Math.ceil(esperar / 60);

    // Este erro pode ser diferente: ele nao diz nada sobre a conta existir.
    return {
      erro: `Muitas tentativas. Tente de novo em ${minutos} ${minutos === 1 ? 'minuto' : 'minutos'}.`,
      tentativa,
    };
  }

  const inicio = Date.now();
  const supabase = await clienteDeAuth(lembrar);
  const { error } = await supabase.auth.signInWithPassword({ email, password: senha });

  // O piso vale para erro E para sucesso: so o erro ter piso faria o sucesso
  // ser o unico caminho rapido, o que tambem e informacao.
  await segura(inicio);

  if (error) {
    return { erro: ERRO_GENERICO, tentativa };
  }

  // Registrado antes do redirect para o middleware saber, nas renovacoes de
  // token que vierem, se aquela sessao era para durar.
  const jar = await cookies();
  jar.set(COOKIE_LEMBRAR, lembrar ? '1' : '0', opcoesDoLembrar(lembrar));

  // Fora do try: `redirect` funciona lancando uma excecao, e um catch acima
  // dele engoliria o redirecionamento.
  redirect(destinoSeguro(form.get('next')?.toString()));
}
