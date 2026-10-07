import { type NextRequest, NextResponse } from 'next/server';
import { cobra, type MotivoDaCobranca } from '@/lib/loja/cobranca';
import { limita } from '@/lib/rate-limit';
import { usuarioDaSessao } from '@/lib/supabase/servidor';

export const dynamic = 'force-dynamic';

/**
 * Rota de cobranca (Issue #110).
 *
 * Fina de proposito: autentica, limita e delega. A decisao de dinheiro mora em
 * `cobra()`, que e testavel sem HTTP.
 *
 * O que volta e o minimo que a tela precisa. Nada de objeto cru do Mercado
 * Pago — ele carrega dado do pagador e campo interno que ninguem pediu.
 */

/** Cinco por hora. O alvo e script tentando cartao em sequencia. */
const LIMITE = { maximo: 5, janelaMs: 60 * 60 * 1000 };

/** Mensagem por motivo. Nenhuma conta se um pedido existe ou nao. */
const RECADOS: Record<MotivoDaCobranca, string> = {
  'entrada-invalida': 'Não consegui ler os dados do pagamento.',
  'sem-sessao': 'Sua sessão expirou. Entre de novo.',
  'pedido-nao-encontrado': 'Pedido não encontrado.',
  'pedido-ja-pago': 'Este pedido já foi pago.',
  'tentativas-demais': 'Muitas tentativas neste pedido.',
  recusado: 'O pagamento não foi aprovado. Você pode tentar de novo.',
  indisponivel: 'Não consegui falar com o pagamento agora. Tente de novo.',
  // Problema nosso, nao do cartao: "nao aprovado" mandaria a pessoa tentar
  // outro cartao a toa. (#23)
  configuracao: 'O pagamento está indisponível no momento. Tente de novo mais tarde.',
  'pagamento-em-processamento':
    'Estamos confirmando seu pagamento anterior. Aguarde um minuto e tente de novo.',
  'pagamento-pendente':
    'Há uma cobrança em aberto neste pedido que não consegui encerrar. Aguarde um minuto e tente de novo.',
};

/** 4xx e problema de quem pediu; 5xx e nosso ou do provedor. */
const CODIGO: Record<MotivoDaCobranca, number> = {
  'entrada-invalida': 400,
  'sem-sessao': 401,
  // 404, e nao 403: dizer "proibido" confirmaria que o pedido existe.
  'pedido-nao-encontrado': 404,
  'pedido-ja-pago': 409,
  'tentativas-demais': 429,
  recusado: 402,
  indisponivel: 502,
  configuracao: 502,
  // Conflito com uma cobranca que ainda esta sendo confirmada, nao falha.
  'pagamento-em-processamento': 409,
  'pagamento-pendente': 409,
};

export async function POST(request: NextRequest) {
  const usuario = await usuarioDaSessao();
  if (!usuario) {
    return NextResponse.json({ erro: RECADOS['sem-sessao'] }, { status: 401 });
  }

  const cota = await limita(`cobranca:${usuario.id}`, LIMITE.maximo, LIMITE.janelaMs);
  if (!cota.permitido) {
    return NextResponse.json(
      { erro: RECADOS['tentativas-demais'] },
      { status: 429, headers: { 'Retry-After': String(cota.esperarS) } }
    );
  }

  const corpo = await request.json().catch(() => null);
  const r = await cobra(corpo);

  if (!r.ok) {
    return NextResponse.json({ erro: RECADOS[r.motivo] }, { status: CODIGO[r.motivo] });
  }

  return NextResponse.json({ estado: r.estado, ...(r.pix ? { pix: r.pix } : {}) });
}
