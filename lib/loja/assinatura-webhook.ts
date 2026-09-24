/**
 * Validacao da assinatura do webhook do Mercado Pago (Issue #45).
 *
 * Funcao pura, sem Next e sem banco, porque e o pedaco em que um erro nao
 * aparece: uma assinatura mal conferida nao quebra nada — ela so deixa
 * qualquer pessoa da internet marcar pedido como pago.
 *
 * O provedor manda dois cabecalhos e um id na query:
 *
 *   x-signature    ts=1732200000,v1=<hmac em hex>
 *   x-request-id   <uuid da notificacao>
 *   ?data.id=      <id do recurso>
 *
 * E a assinatura e HMAC-SHA256 sobre um "manifesto" montado nesta ordem exata:
 *
 *   id:<data.id>;request-id:<x-request-id>;ts:<ts>;
 *
 * Um ponto e virgula fora do lugar muda o hash inteiro, entao o formato e
 * literal de proposito.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Idade maxima da notificacao.
 *
 * Sem isso, uma notificacao legitima capturada hoje vale para sempre: quem a
 * gravasse poderia reenviar meses depois e ela passaria na assinatura. Cinco
 * minutos cobre atraso de rede e reenvio do provedor com folga.
 */
const IDADE_MAXIMA_MS = 5 * 60 * 1000;

type Recusa =
  | 'sem-segredo'
  | 'sem-assinatura'
  | 'assinatura-malformada'
  | 'sem-id'
  | 'carimbo-invalido'
  | 'velha-demais'
  | 'nao-confere';

export type Veredito = { valida: true } | { valida: false; motivo: Recusa };

/** `ts=123,v1=abc` → `{ ts: '123', v1: 'abc' }`. Ordem e espaco nao importam. */
function partes(assinatura: string): Map<string, string> {
  const mapa = new Map<string, string>();

  for (const pedaco of assinatura.split(',')) {
    const igual = pedaco.indexOf('=');
    if (igual === -1) continue;
    mapa.set(pedaco.slice(0, igual).trim(), pedaco.slice(igual + 1).trim());
  }

  return mapa;
}

/** Comparacao em tempo constante, sem vazar onde os hashes divergem. */
function mesmoHash(a: string, b: string): boolean {
  // `timingSafeEqual` lanca quando os tamanhos diferem, e o proprio tamanho ja
  // seria um vazamento. Conferir antes resolve os dois.
  if (a.length !== b.length) return false;

  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    // Hex invalido. Nao e assinatura nossa.
    return false;
  }
}

export type EntradaDaAssinatura = {
  assinatura: string | null;
  requestId: string | null;
  /** O `data.id` da query. */
  recursoId: string | null;
  segredo: string | undefined;
  /** Injetavel para o teste nao depender do relogio. */
  agoraMs?: number;
};

export function conferaAssinatura({
  assinatura,
  requestId,
  recursoId,
  segredo,
  agoraMs = Date.now(),
}: EntradaDaAssinatura): Veredito {
  // Falha fechada: sem segredo cadastrado, NADA e aceito. A alternativa —
  // "deixa passar enquanto nao configurou" — e um endpoint aberto esperando
  // ser encontrado.
  if (!segredo) return { valida: false, motivo: 'sem-segredo' };
  if (!assinatura) return { valida: false, motivo: 'sem-assinatura' };
  if (!recursoId) return { valida: false, motivo: 'sem-id' };

  const campos = partes(assinatura);
  const ts = campos.get('ts');
  const v1 = campos.get('v1');

  if (!ts || !v1) return { valida: false, motivo: 'assinatura-malformada' };

  const carimbo = Number(ts);
  if (!Number.isFinite(carimbo) || carimbo <= 0) {
    return { valida: false, motivo: 'carimbo-invalido' };
  }

  // O provedor manda em milissegundos; versoes antigas mandavam em segundos.
  // Um numero de dez digitos e segundo — aceitar os dois evita recusar
  // notificacao legitima por causa de unidade.
  const carimboMs = String(ts).length <= 10 ? carimbo * 1000 : carimbo;

  // `Math.abs`: relogio adiantado do outro lado tambem e suspeito. Notificacao
  // do futuro nao existe.
  if (Math.abs(agoraMs - carimboMs) > IDADE_MAXIMA_MS) {
    return { valida: false, motivo: 'velha-demais' };
  }

  // Id alfanumerico vai em minuscula, conforme a documentacao. Id numerico
  // fica como esta.
  const id = /^\d+$/.test(recursoId) ? recursoId : recursoId.toLowerCase();

  // A ordem e o ponto e virgula final sao literais. Nao "arrumar".
  const manifesto = `id:${id};request-id:${requestId ?? ''};ts:${ts};`;
  const esperado = createHmac('sha256', segredo).update(manifesto).digest('hex');

  return mesmoHash(esperado, v1.toLowerCase())
    ? { valida: true }
    : { valida: false, motivo: 'nao-confere' };
}

/**
 * DIAGNOSTICO TEMPORARIO — remover antes do merge.
 *
 * A notificacao real do provedor chegou e nao conferiu. Ha duas causas
 * possiveis e elas pedem acoes opostas: segredo errado (mexer na Vercel) ou
 * manifesto errado (mexer no codigo). Isto separa as duas em um deploy.
 *
 * Testa as variacoes ambiguas da documentacao e diz QUAL fecha. Nao imprime
 * segredo nem hash: so o nome da variacao. Se nenhuma fechar, o segredo e que
 * esta errado.
 */
export function qualManifesto({
  assinatura,
  requestId,
  recursoId,
  segredo,
}: Omit<EntradaDaAssinatura, 'agoraMs'>): string {
  if (!segredo || !assinatura || !recursoId) return 'entrada-incompleta';

  const campos = partes(assinatura);
  const ts = campos.get('ts');
  const v1 = campos.get('v1');
  if (!ts || !v1) return 'header-malformado';

  const minusculo = /^\d+$/.test(recursoId) ? recursoId : recursoId.toLowerCase();
  const req = requestId ?? '';

  const candidatos: [string, string][] = [
    ['id-como-veio', `id:${recursoId};request-id:${req};ts:${ts};`],
    ['id-minusculo', `id:${minusculo};request-id:${req};ts:${ts};`],
    ['sem-request-id', `id:${recursoId};ts:${ts};`],
    ['sem-request-id-minusculo', `id:${minusculo};ts:${ts};`],
    ['sem-ponto-final', `id:${recursoId};request-id:${req};ts:${ts}`],
    ['id-maiusculo', `id:${recursoId.toUpperCase()};request-id:${req};ts:${ts};`],
  ];

  for (const [nome, manifesto] of candidatos) {
    const esperado = createHmac('sha256', segredo).update(manifesto).digest('hex');
    if (mesmoHash(esperado, v1.toLowerCase())) return nome;
  }

  return 'nenhuma-variacao-fecha';
}
