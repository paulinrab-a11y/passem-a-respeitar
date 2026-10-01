import { NextResponse } from 'next/server';
import { pergunta } from '@/lib/concierge/gemini';
import { esquemaConcierge } from '@/lib/esquemas';
import { ipDoRequest, limita } from '@/lib/rate-limit';
import { CAMPO_DA_ISCA, desafioConfere, pareceRobo, RECUSA } from '@/lib/robo';

// Le variavel de ambiente por request e fala com um servico de fora: nada
// aqui pode ser cacheado.
export const dynamic = 'force-dynamic';

/** 20 perguntas a cada 10 minutos por IP. */
const MAXIMO = 20;
const JANELA_MS = 10 * 60 * 1000;

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
 * entao a chamada para fora.
 */
export async function POST(request: Request) {
  const ip = ipDoRequest(request.headers);
  const cota = await limita(`concierge:${ip}`, MAXIMO, JANELA_MS);

  if (!cota.permitido) {
    return erro('Muitas perguntas de uma vez. Espera um pouco e tenta de novo.', 429, {
      'Retry-After': String(cota.esperarS),
    });
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

  const resposta = await pergunta(entrada.data.historico, entrada.data.mensagem);
  if (resposta === null) {
    return erro(ERRO_DO_CONCIERGE, 502);
  }

  return NextResponse.json({ ok: true, resposta }, { headers: SEM_CACHE });
}
