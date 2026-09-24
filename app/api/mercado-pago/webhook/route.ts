import { type NextRequest, NextResponse } from 'next/server';
import { conferaAssinatura, qualManifesto } from '@/lib/loja/assinatura-webhook';
import { processa } from '@/lib/loja/webhook';

export const dynamic = 'force-dynamic';

/**
 * Webhook do Mercado Pago (Issue #45).
 *
 * Endpoint PUBLICO — nao tem sessao nem cookie para se apoiar. A unica coisa
 * que separa uma confirmacao de pagamento de qualquer pessoa da internet e a
 * assinatura, e por isso ela e a primeira coisa que acontece aqui.
 *
 * Sobre os codigos de resposta: o provedor REENVIA quando nao recebe 2xx.
 * Entao a escolha de codigo e uma instrucao para ele:
 *
 *   200  processado, ou ja tinha sido. Nao precisa reenviar.
 *   401  assinatura invalida. Reenviar nao vai ajudar.
 *   500  nao consegui confirmar agora. REENVIE.
 *
 * Devolver 200 para o que nao foi processado perderia a notificacao para
 * sempre; devolver 500 para o que ja foi processado faria o provedor insistir
 * em algo que nao muda mais.
 */
export async function POST(request: NextRequest) {
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

  if (!veredito.valida) {
    // O motivo fica no log do servidor, nao na resposta: quem esta tentando
    // forjar nao precisa saber se errou o carimbo ou o hash.
    console.warn('[webhook] recusado:', veredito.motivo);
    // DIAGNOSTICO TEMPORARIO — remover antes do merge.
    if (veredito.motivo === 'nao-confere') {
      console.warn(
        '[webhook] diagnostico:',
        qualManifesto({
          assinatura: request.headers.get('x-signature'),
          requestId: request.headers.get('x-request-id'),
          recursoId,
          segredos: {
            principal: process.env.MERCADOPAGO_WEBHOOK_SECRET,
            alternativo: process.env.MERCADOPAGO_WEBHOOK_SECRET_ALT,
          },
        }),
        '| tem request-id:',
        request.headers.get('x-request-id') !== null,
        '| id:',
        recursoId,
        '| type:',
        url.searchParams.get('type') ?? url.searchParams.get('topic')
      );
    }
    return NextResponse.json({ erro: 'assinatura invalida' }, { status: 401 });
  }

  // Qual configuracao do painel assinou. So no log: a resposta nao conta nada
  // a quem nao passou.
  console.info('[webhook] assinatura de:', veredito.origem);

  const corpo = await request.json().catch(() => null);
  const r = await processa(corpo, recursoId);

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
