import { NextResponse } from 'next/server';
import { assinaturaConfere, fala } from '@/lib/concierge/voz';
import { esquemaConciergeVoz } from '@/lib/esquemas';
import { ipDoRequest, limita } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
// A geracao da fala leva ate 20 s (lib/concierge/voz.ts).
export const maxDuration = 30;

/** 10 audios a cada 10 minutos por IP: metade do limite do chat. */
const MAXIMO = 10;
const JANELA_MS = 10 * 60 * 1000;

const ERRO_DE_ENTRADA = 'Não deu para gerar esse áudio.';
const ERRO_DA_VOZ = 'O concierge ficou sem voz por um instante. Tenta de novo.';

const SEM_CACHE = { 'Cache-Control': 'no-store' };

function erro(mensagem: string, status: number, extra?: HeadersInit) {
  return NextResponse.json(
    { ok: false, erro: mensagem },
    { status, headers: { ...SEM_CACHE, ...extra } }
  );
}

/**
 * Voz do Concierge (Issue #193). Fala um texto que o Concierge produziu.
 *
 * Nao tem isca nem desafio: o que segura esta rota e a assinatura, que so a
 * rota do chat emite, e o limite por IP. Texto sem assinatura valida nem
 * chega perto do Gemini.
 */
export async function POST(request: Request) {
  const ip = ipDoRequest(request.headers);
  const cota = await limita(`concierge-voz:${ip}`, MAXIMO, JANELA_MS);
  if (!cota.permitido) {
    return erro('Muitos áudios de uma vez. Espera um pouco.', 429, {
      'Retry-After': String(cota.esperarS),
    });
  }

  let corpo: unknown;
  try {
    corpo = await request.json();
  } catch {
    return erro(ERRO_DE_ENTRADA, 400);
  }

  const entrada = esquemaConciergeVoz.safeParse(corpo);
  if (!entrada.success) return erro(ERRO_DE_ENTRADA, 400);

  if (!(await assinaturaConfere(entrada.data.texto, entrada.data.assinatura))) {
    return erro(ERRO_DE_ENTRADA, 403);
  }

  const wav = await fala(entrada.data.texto);
  if (!wav) return erro(ERRO_DA_VOZ, 502);

  return new Response(wav, {
    headers: { ...SEM_CACHE, 'Content-Type': 'audio/wav', 'Content-Length': String(wav.length) },
  });
}
