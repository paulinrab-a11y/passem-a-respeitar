import { timingSafeEqual } from 'node:crypto';
import * as Sentry from '@sentry/nextjs';
import { type NextRequest, NextResponse } from 'next/server';
import { concilia } from '@/lib/loja/conciliacao';
import { expiraVencidos } from '@/lib/loja/expiracao';
import { ipDoRequest, limita } from '@/lib/rate-limit';
import { enviaDepois } from '@/lib/sentry/depois';
import { MONITOR } from '@/lib/sentry/monitor-da-conciliacao';

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

  // Check-in so depois da autorizacao: quem chuta o segredo nao mexe no
  // monitor (#273).
  const checkInId = Sentry.captureCheckIn(
    { monitorSlug: MONITOR.slug, status: 'in_progress' },
    MONITOR.config
  );
  const inicio = Date.now();
  const fecha = (status: 'ok' | 'error') => {
    Sentry.captureCheckIn(
      {
        monitorSlug: MONITOR.slug,
        status,
        checkInId,
        duration: (Date.now() - inicio) / 1000,
      },
      MONITOR.config
    );
    // Depois da resposta (#281): a Vercel nao espera o envio.
    enviaDepois();
  };

  try {
    const balanco = await concilia();

    // Resumido, e de proposito: contagens, nunca ids de pedido ou de pagamento.
    console.info('[conciliacao]', JSON.stringify(balanco));

    // Depois da conciliacao, e na mesma chamada (#298): o plano da Vercel roda
    // um cron por dia, e um Pix pago que so a conciliacao descobriu precisa
    // virar `pago` ANTES de alguem olhar o prazo do pedido dele. A expiracao
    // ainda confere cada pedido no provedor; esta ordem so poupa a viagem.
    const expiracao = await expiraVencidos();
    console.info('[expiracao]', JSON.stringify(expiracao));

    // Falha em consultar o provedor nao derruba o cron: o proximo ciclo tenta
    // de novo, e a resposta continua 200 com o balanco. Mas o check-in vai
    // como `error` (#273): uma falha num dia e ruido, falha todo dia e token
    // vencido ou provedor fora, e so o monitor enxerga a sequencia.
    fecha(balanco.falhas > 0 ? 'error' : 'ok');

    return NextResponse.json({ ok: true, ...balanco, expiracao });
  } catch (erro) {
    // Excecao segue para o Sentry pelo caminho de sempre e vira 500; o
    // check-in fecha como `error` para o monitor nao ficar `in_progress` ate
    // estourar o `maxRuntime`. Banco fora chega aqui porque `concilia` e
    // `expiraVencidos` transformam o `{ error }` da varredura em excecao: o
    // supabase-js, sozinho, nao lanca.
    fecha('error');
    throw erro;
  }
}
