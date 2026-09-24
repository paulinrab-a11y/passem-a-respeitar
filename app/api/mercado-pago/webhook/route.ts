import { type NextRequest, NextResponse } from 'next/server';
import { conferaAssinatura } from '@/lib/loja/assinatura-webhook';
import { processa } from '@/lib/loja/webhook';
import { ipDoRequest, limita } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

/**
 * Webhook do Mercado Pago (Issue #45).
 *
 * Endpoint PUBLICO — nao tem sessao nem cookie para se apoiar. O que separa
 * uma confirmacao de pagamento de qualquer pessoa da internet e a assinatura
 * e, atras dela, a consulta server-to-server que decide de verdade
 * (lib/loja/webhook.ts — inclusive o porque de existir um caminho sem
 * assinatura restrito a ordem de teste).
 *
 * Sobre os codigos de resposta: o provedor REENVIA quando nao recebe 2xx.
 * Entao a escolha de codigo e uma instrucao para ele:
 *
 *   200  processado, ou ja tinha sido. Nao precisa reenviar.
 *   401  sem prova de origem e fora do sandbox. Reenviar nao vai ajudar.
 *   429  IP passou da cota. Reenviar depois.
 *   500  nao consegui confirmar agora. REENVIE.
 *
 * Devolver 200 para o que nao foi processado perderia a notificacao para
 * sempre; devolver 500 para o que ja foi processado faria o provedor insistir
 * em algo que nao muda mais.
 */

/**
 * Por IP, por minuto. Notificacao legitima chega de poucos IPs e em rajadas
 * curtas; isto segura quem descobrir a URL e tentar nos fazer consultar o
 * provedor em loop.
 */
const LIMITE = { maximo: 60, janelaMs: 60 * 1000 };

export async function POST(request: NextRequest) {
  const cota = limita(`webhook-mp:${ipDoRequest(request.headers)}`, LIMITE.maximo, LIMITE.janelaMs);
  if (!cota.permitido) {
    return NextResponse.json({ ok: false }, { status: 429 });
  }

  const url = new URL(request.url);

  // O provedor manda o id do recurso em `data.id`; ha integracoes antigas que
  // mandam so `id`.
  const recursoId = url.searchParams.get('data.id') ?? url.searchParams.get('id');

  const veredito = conferaAssinatura({
    assinatura: request.headers.get('x-signature'),
    requestId: request.headers.get('x-request-id'),
    recursoId,
    segredos: {
      principal: process.env.MERCADOPAGO_WEBHOOK_SECRET,
      alternativo: process.env.MERCADOPAGO_WEBHOOK_SECRET_ALT,
    },
  });

  // O motivo fica no log do servidor, nao na resposta: quem esta tentando
  // forjar nao precisa saber se errou o carimbo ou o hash.
  if (veredito.valida) {
    console.info('[webhook] assinatura de:', veredito.origem);
  } else {
    console.warn('[webhook] sem assinatura valida:', veredito.motivo);
  }

  const corpo = await request.json().catch(() => null);
  const r = await processa(corpo, recursoId, { assinada: veredito.valida });

  if (r.tipo === 'recusado') {
    console.warn('[webhook] recusado:', r.motivo);
    return NextResponse.json({ erro: 'assinatura invalida' }, { status: 401 });
  }

  if (r.tipo === 'tente-de-novo') {
    console.warn('[webhook] nao processado:', r.motivo);
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  // Log minimo, e de proposito: nada de corpo, nada de dado do pagador. So o
  // suficiente para responder "este evento chegou e o que virou".
  console.info('[webhook]', r.tipo, r.tipo === 'aplicado' ? r.estado : r.motivo);

  return NextResponse.json({ ok: true });
}

/**
 * O painel do Mercado Pago testa a URL antes de salvar a configuracao.
 * Responder aqui evita "URL invalida" na hora de cadastrar.
 */
export async function GET() {
  return NextResponse.json({ ok: true });
}
