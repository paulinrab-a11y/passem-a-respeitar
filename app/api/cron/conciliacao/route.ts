import { timingSafeEqual } from 'node:crypto';
import { type NextRequest, NextResponse } from 'next/server';
import { concilia } from '@/lib/loja/conciliacao';
import { ipDoRequest, limita } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

/**
 * Cron de conciliacao (Issue #114).
 *
 * Chamado pela Vercel no horario de `vercel.json`, com
 * `Authorization: Bearer <CRON_SECRET>` — a Vercel poe o cabecalho sozinha
 * quando a variavel existe. Qualquer outro agendador serve, desde que mande o
 * mesmo cabecalho.
 *
 * Sem `CRON_SECRET` cadastrado, NADA passa. A alternativa — "deixa rodar
 * enquanto nao configurou" — e uma rota publica que faz N consultas ao
 * provedor a cada chamada. Falha fechada, como o webhook.
 */

function autorizado(cabecalho: string | null): boolean {
  const segredo = process.env.CRON_SECRET;
  if (!segredo || !cabecalho) return false;

  const recebido = Buffer.from(cabecalho);
  const esperado = Buffer.from(`Bearer ${segredo}`);
  // Tamanho diferente ja e "nao". Conferir antes evita o throw do
  // timingSafeEqual e nao vaza nada que o 401 ja nao diga. Em bytes, e nao
  // em caracteres: um 'é' tem 1 caractere e 2 bytes, passava pela conta de
  // caracteres e o throw virava 500 so no tamanho exato do segredo (#287).
  if (recebido.length !== esperado.length) return false;

  // Quem nao passa recebe 401, sempre. Um 500 aqui e acessivel sem
  // autenticacao e diz alguma coisa que o 401 nao diz.
  try {
    return timingSafeEqual(recebido, esperado);
  } catch {
    return false;
  }
}

/** O cron legitimo chama uma vez por dia. Dez por minuto ja e ataque. (#22) */
const LIMITE = { maximo: 10, janelaMs: 60 * 1000 };

export async function GET(request: NextRequest) {
  // Antes da autorizacao, de proposito: quem esta chutando o segredo tambem
  // e limitado.
  const cota = await limita(`cron:${ipDoRequest(request.headers)}`, LIMITE.maximo, LIMITE.janelaMs);
  if (!cota.permitido) {
    return NextResponse.json(
      { erro: 'nao autorizado' },
      { status: 429, headers: { 'Retry-After': String(cota.esperarS) } }
    );
  }

  if (!autorizado(request.headers.get('authorization'))) {
    return NextResponse.json({ erro: 'nao autorizado' }, { status: 401 });
  }

  const balanco = await concilia();

  // Resumido, e de proposito: contagens, nunca ids de pedido ou de pagamento.
  console.info('[conciliacao]', JSON.stringify(balanco));

  // Falha em consultar nao e falha do cron: o proximo ciclo tenta de novo. 200
  // sempre que a varredura rodou; o balanco diz o resto.
  return NextResponse.json({ ok: true, ...balanco });
}
