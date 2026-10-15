import 'server-only';

import * as Sentry from '@sentry/nextjs';

/**
 * Protecao contra bot nos formularios publicos (Issue #28).
 *
 * Duas barreiras, e nenhuma delas mora no cliente:
 *
 *   - Isca: um campo que a pessoa nao ve e nao alcanca pelo teclado. Quem
 *     preenche e script que preenche tudo o que acha.
 *   - Desafio: o Cloudflare Turnstile. O navegador recebe um token e manda
 *     junto com o formulario; quem diz se o token vale e a Cloudflare,
 *     perguntada DAQUI, com a chave secreta. Token que so o cliente conferiu
 *     nao foi conferido.
 *
 * O token vale uma vez e por cinco minutos. Por isso cada envio gasta um, e o
 * formulario pede outro depois de cada resposta.
 *
 * O que esta protecao NAO cobre: quem fala direto com a API do Supabase, sem
 * passar pelo site. La quem segura e o limite do proprio Supabase.
 */

/** Nome que script gosta de preencher, e que navegador nao preenche sozinho. */
export const CAMPO_DA_ISCA = 'website';

/** O nome que o widget da ao campo escondido dele. */
export const CAMPO_DO_DESAFIO = 'cf-turnstile-response';

/** Uma acao por formulario: token tirado em um nao vale no outro. */
export type Acao =
  | 'entrar'
  | 'criar-conta'
  | 'reenviar-codigo'
  | 'recuperar-senha'
  | 'convite'
  | 'concierge';

/**
 * Mensagem unica para isca preenchida, token ausente, token recusado e
 * Cloudflare fora do ar. Dizer qual foi ensinaria o script a se corrigir.
 */
export const RECUSA =
  'Não deu para confirmar que você não é um robô. Recarregue a página e tente de novo.';

const CONFERENCIA = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** O token de verdade tem algumas centenas de caracteres; a Cloudflare garante ate 2048. */
const TOKEN_MAXIMO = 2048;

/** Quanto se espera a Cloudflare. Rota com prazo curto conta com ele (#281). */
export const ESPERA_DO_DESAFIO_MS = 5000;

type Protecao = 'ligada' | 'desligada' | 'faltando';

/**
 * Lido a cada chamada, nao no topo do modulo: o teste troca o ambiente.
 *
 * Sem as duas chaves, o desafio fica desligado e a isca continua valendo —
 * menos em producao. La, chave faltando e erro de configuracao, e a resposta
 * e recusar: formulario publico sem protecao nao pode ser o resultado
 * silencioso de uma variavel apagada.
 */
function protecao(): Protecao {
  const completa =
    Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY) &&
    Boolean(process.env.TURNSTILE_SECRET_KEY);

  if (completa) return 'ligada';
  return process.env.VERCEL_ENV === 'production' ? 'faltando' : 'desligada';
}

async function avisa(motivo: string) {
  Sentry.captureMessage('protecao contra bot: nao consegui conferir', {
    level: 'error',
    tags: { motivo },
  });
  // Funcao serverless congela assim que responde; sem isto o evento nao sai.
  await Sentry.flush(2000);
}

/**
 * O que da para recusar sem gastar nada: nem tentativa do limite, nem chamada
 * a Cloudflare. Vem antes de tudo na acao.
 */
/**
 * So a isca, para formulario sem desafio (#224): o codigo de confirmacao ja e
 * um segredo que chegou por e-mail, e o Supabase limita as tentativas.
 * Ausente ou vazio e o esperado. Qualquer outra coisa, inclusive tipo
 * estranho, e alguem escrevendo onde nao ha o que escrever.
 */
export function iscaPreenchida(isca: unknown): boolean {
  return isca !== null && isca !== undefined && isca !== '';
}

export async function pareceRobo(entrada: { isca: unknown; desafio: unknown }): Promise<boolean> {
  if (iscaPreenchida(entrada.isca)) return true;

  const estado = protecao();
  if (estado === 'desligada') return false;

  if (estado === 'faltando') {
    await avisa('sem-chave');
    return true;
  }

  const { desafio } = entrada;
  return typeof desafio !== 'string' || desafio.length === 0 || desafio.length > TOKEN_MAXIMO;
}

type Resposta = {
  success?: boolean;
  action?: string;
  'error-codes'?: string[];
  metadata?: { result_with_testing_key?: boolean };
};

/**
 * Pergunta a Cloudflare se o token vale. Vem DEPOIS do limite por IP: e uma
 * chamada para fora, e rajada nao pode virar uma chamada por request. E ANTES
 * do limite por e-mail, onde houver um (#260, #285): antes daqui qualquer
 * texto passa por token, e quem gasta a cota de um e-mail precisa ter
 * passado pelo desafio, senao um script trocando de IP tranca a conta alheia.
 *
 * Falha fechada: Cloudflare fora do ar, resposta torta ou demora recusam o
 * envio. O contrario seria a protecao sumir justamente quando alguem
 * consegue derrubar a conferencia.
 */
export async function desafioConfere(desafio: unknown, acao: Acao, ip: string): Promise<boolean> {
  if (protecao() === 'desligada') return true;

  const segredo = process.env.TURNSTILE_SECRET_KEY;
  if (!segredo || typeof desafio !== 'string' || !desafio) return false;

  let resposta: Resposta;
  try {
    const corpo = new URLSearchParams({ secret: segredo, response: desafio });
    // Sem IP conhecido nao vai IP nenhum: mandar o balde unico do limite
    // diria a Cloudflare que todo visitante e o mesmo.
    if (ip !== 'desconhecido') corpo.set('remoteip', ip);

    const r = await fetch(CONFERENCIA, {
      method: 'POST',
      body: corpo,
      signal: AbortSignal.timeout(ESPERA_DO_DESAFIO_MS),
      cache: 'no-store',
    });
    resposta = (await r.json()) as Resposta;
  } catch {
    await avisa('fora-do-ar');
    return false;
  }

  if (resposta.success !== true) {
    // Token vencido, repetido ou inventado e o dia a dia. O que merece aviso
    // e o erro que e NOSSO: chave secreta errada ou pedido malformado.
    const nosso = (resposta['error-codes'] ?? []).find(
      (c) => c.endsWith('-input-secret') || c === 'bad-request'
    );
    if (nosso) await avisa(nosso);
    return false;
  }

  // As chaves de teste que a Cloudflare publica aceitam QUALQUER token. Servem
  // para a suite; em producao seriam a protecao desligada com cara de ligada.
  if (resposta.metadata?.result_with_testing_key) {
    if (process.env.VERCEL_ENV !== 'production') return true;
    await avisa('chave-de-teste');
    return false;
  }

  return resposta.action === acao;
}
