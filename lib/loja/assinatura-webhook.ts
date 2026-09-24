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

/** Qual das configuracoes do painel assinou. Vai para o log, nunca na resposta. */
export type Origem = 'principal' | 'alternativo';

export type Veredito = { valida: true; origem: Origem } | { valida: false; motivo: Recusa };

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
  /**
   * Os segredos aceitos, em ordem de tentativa.
   *
   * Sao dois porque o painel do provedor tem uma configuracao por modo, cada
   * uma com o SEU segredo, e as duas podem apontar para esta mesma URL. Com um
   * segredo so, metade das notificacoes seria recusada por construcao — e a
   * recusa pareceria ataque, nao configuracao.
   *
   * O segundo serve tambem para trocar o segredo sem derrubar nada: cadastra o
   * novo no alternativo, troca no painel, promove a principal.
   *
   * Aceitar dois nao afrouxa: cada um continua exigindo o HMAC correto.
   */
  segredos: { principal: string | undefined; alternativo?: string | undefined };
  /** Injetavel para o teste nao depender do relogio. */
  agoraMs?: number;
};

export function conferaAssinatura({
  assinatura,
  requestId,
  recursoId,
  segredos,
  agoraMs = Date.now(),
}: EntradaDaAssinatura): Veredito {
  const configurados: [Origem, string][] = [
    ['principal', segredos.principal],
    ['alternativo', segredos.alternativo],
  ].filter((par): par is [Origem, string] => Boolean(par[1]));

  // Falha fechada: sem segredo cadastrado, NADA e aceito. A alternativa —
  // "deixa passar enquanto nao configurou" — e um endpoint aberto esperando
  // ser encontrado.
  if (configurados.length === 0) return { valida: false, motivo: 'sem-segredo' };
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
  const recebido = v1.toLowerCase();

  for (const [origem, segredo] of configurados) {
    const esperado = createHmac('sha256', segredo).update(manifesto).digest('hex');
    if (mesmoHash(esperado, recebido)) return { valida: true, origem };
  }

  return { valida: false, motivo: 'nao-confere' };
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
  segredos,
}: Omit<EntradaDaAssinatura, 'agoraMs'>): string {
  const chaves: [string, string][] = [
    ['principal', segredos.principal ?? ''],
    ['alternativo', segredos.alternativo ?? ''],
  ].filter((par): par is [string, string] => Boolean(par[1]));

  if (chaves.length === 0 || !assinatura || !recursoId) return 'entrada-incompleta';

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

  // Cada chave e testada como esta e sem espaco em volta: colagem com quebra
  // de linha e o erro mais comum e o mais invisivel.
  for (const [onde, bruta] of chaves) {
    for (const [rotulo, chave] of [
      ['', bruta],
      ['+trim', bruta.trim()],
    ] as [string, string][]) {
      if (rotulo && chave === bruta) continue;
      for (const [nome, manifesto] of candidatos) {
        const esperado = createHmac('sha256', chave).update(manifesto).digest('hex');
        if (mesmoHash(esperado, v1.toLowerCase())) return `${onde}: ${nome}${rotulo}`;
      }
    }
  }

  // O comprimento nao revela o segredo e separa 'colei errado' de 'colei
  // truncado'. O do provedor tem 64 caracteres hexadecimais.
  const forma = chaves.map(([onde, k]) => `${onde}=${k.length}`).join(' ');
  return `nenhuma-variacao-fecha (${forma})`;
}
