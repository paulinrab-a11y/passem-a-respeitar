import { timingSafeEqual } from 'node:crypto';
import { type NextRequest, NextResponse } from 'next/server';
import { concilia } from '@/lib/loja/conciliacao';

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

  const esperado = `Bearer ${segredo}`;
  // Tamanho diferente ja e "nao". Conferir antes evita o throw do
  // timingSafeEqual e nao vaza nada que o 401 ja nao diga.
  if (cabecalho.length !== esperado.length) return false;

  return timingSafeEqual(Buffer.from(cabecalho), Buffer.from(esperado));
}

export async function GET(request: NextRequest) {
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
