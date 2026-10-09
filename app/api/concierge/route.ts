import { NextResponse } from 'next/server';
import { pergunta } from '@/lib/concierge/gemini';
import { esquemaConcierge } from '@/lib/esquemas';
import { ipDoRequest, limita } from '@/lib/rate-limit';
import { CAMPO_DA_ISCA, desafioConfere, pareceRobo, RECUSA } from '@/lib/robo';

// Le variavel de ambiente por request e fala com um servico de fora: nada
// aqui pode ser cacheado.
export const dynamic = 'force-dynamic';
// O pior caso, etapa por etapa, cada uma no proprio prazo (#281):
//
//   limite por IP, no Redis ................ 1 s   lib/rate-limit.ts
//   Turnstile, na Cloudflare ............... 5 s   lib/robo.ts
//   teto global, no Redis .................. 1 s
//   catalogo, para o bloco da loja ......... 2 s   lib/concierge/gemini.ts
//   Gemini, principal e reserva ....... 2 x 12 s   lib/concierge/gemini.ts
//   envio ao Sentry, depois da resposta .... 2 s   lib/sentry/depois.ts
//                                           ----
//                                           35 s
//
// Com 30, o reserva respondia e a Vercel derrubava a funcao antes de a
// resposta sair. 60 vale no Hobby e no Pro, e o route.test.ts refaz a conta
// com fake timers: quem subir um prazo ve o teste quebrar, nao a producao.
export const maxDuration = 60;

/** 20 perguntas a cada 10 minutos por IP. */
const MAXIMO = 20;
const JANELA_MS = 10 * 60 * 1000;

/**
 * Teto do site inteiro por hora (#281), contra a cota da chave do Gemini: o
 * limite por IP nao segura a soma de visitantes do lancamento, nem poucos IPs
 * com token de Turnstile. Batido o teto, o concierge espera a hora virar — e
 * a chave continua com cota para o dia seguinte, sem virar fatura.
 *
 * O padrao e conservador; o numero certo depende do plano da chave, e por
 * isso vem do ambiente.
 */
const TETO_POR_HORA_PADRAO = 300;
const HORA_MS = 60 * 60 * 1000;

/**
 * Lido a cada chamada, nao no import: o teste troca o ambiente. Valor torto
 * (vazio, zero, negativo, quebrado) vale o padrao — erro de digitacao na
 * Vercel nao pode desligar o concierge, nem tirar o teto.
 */
function tetoPorHora(): number {
  const lido = Number(process.env.CONCIERGE_LIMITE_HORA);
  return Number.isInteger(lido) && lido > 0 ? lido : TETO_POR_HORA_PADRAO;
}

const MUITAS_PERGUNTAS = 'Muitas perguntas de uma vez. Espera um pouco e tenta de novo.';

/**
 * Uma mensagem para corpo quebrado, campo faltando, texto grande demais e
 * historico fora do formato. A diferenca nao ajuda a pessoa e ajuda o script.
 */
const ERRO_DE_ENTRADA = 'Não entendi. Escreve a pergunta de novo, mais curta.';

/** O que a pessoa le quando o Gemini nao responde, seja por que for. */
const ERRO_DO_CONCIERGE = 'O concierge saiu por um instante. Tenta de novo em alguns segundos.';

const SEM_CACHE = { 'Cache-Control': 'no-store' };

function erro(mensagem: string, status: number, extra?: HeadersInit) {
  return NextResponse.json(
    { ok: false, erro: mensagem },
    { status, headers: { ...SEM_CACHE, ...extra } }
  );
}

/**
 * Concierge do EP (Issue #191).
 *
 * Mesma ordem do convite, e pelo mesmo motivo: o que e barato de recusar vem
 * antes do que custa. Limite, depois isca e desafio, depois formato, e so
 * entao o teto global e a chamada para fora.
 */
export async function POST(request: Request) {
  const ip = ipDoRequest(request.headers);
  const cota = await limita(`concierge:${ip}`, MAXIMO, JANELA_MS);

  if (!cota.permitido) {
    return erro(MUITAS_PERGUNTAS, 429, { 'Retry-After': String(cota.esperarS) });
  }

  let corpo: Record<string, unknown>;
  try {
    const lido: unknown = await request.json();
    if (lido === null || typeof lido !== 'object' || Array.isArray(lido)) {
      return erro(ERRO_DE_ENTRADA, 400);
    }
    corpo = lido as Record<string, unknown>;
  } catch {
    return erro(ERRO_DE_ENTRADA, 400);
  }

  // Protecao contra bot (#28), antes de olhar a pergunta: a resposta fala do
  // envio, e nao do que foi escrito.
  if (
    (await pareceRobo({ isca: corpo[CAMPO_DA_ISCA], desafio: corpo.desafio })) ||
    !(await desafioConfere(corpo.desafio, 'concierge', ip))
  ) {
    return erro(RECUSA, 403);
  }

  // `parse` devolve so o que o schema descreve: campo a mais morre aqui.
  const entrada = esquemaConcierge.safeParse(corpo);
  if (!entrada.success) {
    return erro(ERRO_DE_ENTRADA, 400);
  }

  // Por ultimo, colado na chamada ao Gemini: o teto conta o que gastaria a
  // cota da chave, e so isso. Antes do limite por IP, um IP so, mesmo sem
  // token, gastaria o teto de todo mundo com POST que nunca chega ao Google.
  const teto = await limita('concierge:global', tetoPorHora(), HORA_MS);
  if (!teto.permitido) {
    return erro(MUITAS_PERGUNTAS, 429, { 'Retry-After': String(teto.esperarS) });
  }

  const resposta = await pergunta(entrada.data.historico, entrada.data.mensagem);
  if (resposta === null) {
    return erro(ERRO_DO_CONCIERGE, 502);
  }

  return NextResponse.json({ ok: true, resposta }, { headers: SEM_CACHE });
}
