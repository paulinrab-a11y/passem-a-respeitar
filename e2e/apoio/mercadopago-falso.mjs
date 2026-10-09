// Um Mercado Pago de mentira, nesta maquina, para a suite de ponta a ponta
// (#274).
//
// A ordem e criada no SERVIDOR do site (lib/loja/orders-api.ts), entao o
// `page.route` do Playwright nao a alcanca: e preciso um servidor do outro
// lado, como o Melhor Envio falso do frete. O de verdade precisa de conta, de
// credencial e de rede, e um cartao de teste dele nao e escolhido por quem
// testa. Aqui cada cenario e combinado, e o servidor guarda o que recebeu: o
// teste confere o que o site mandou, alem do que ele mostrou.
//
// O formato e o da Orders API: POST /v1/orders com X-Idempotency-Key, GET
// /v1/orders/{id}, busca por external_reference, POST .../cancel e
// .../refund. O id comeca com ORDTST, que e o prefixo que o Mercado Pago da
// as ordens feitas com credencial de teste — e o que o webhook do site aceita
// sem assinatura, confirmando pela consulta (lib/loja/webhook.ts).
//
// O cenario do cartao vem no comeco do token, porque e so o token que o site
// repassa: no Mercado Pago de verdade quem decide e o nome no cartao de teste,
// que nunca chega ao servidor.

import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';

export const PORTA_DO_MP = 46332;
export const TOKEN_DO_MP = 'TEST-token-da-suite';

/** O comeco do token do cartao escolhe o que o falso responde. */
export const CARTOES = {
  /** 201, `processed`: aprovado na hora. */
  aprovado: 'aprovado',
  /** 402, `failed`: o emissor recusou. */
  recusado: 'recusado',
  /** 201, mas `failed`: cartao sem limite tambem volta 2xx (#20). */
  semLimite: 'semlimite',
  /** 201, `processing`: o cartao foi para analise. */
  emAnalise: 'analise',
};

/**
 * Um PNG de 1x1. O QR de verdade e do provedor, e a tela so o mostra: o que o
 * teste confere e que a imagem que chegou e esta.
 */
export const QR_DO_PIX =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

/** O copia-e-cola de uma ordem. Nao e Pix pagavel: nao tem chave nem CRC. */
export function copiaECola(ordem) {
  return `pix-falso-da-suite.${ordem}`;
}

const ordens = new Map();
/** Resposta guardada por chave: reenviar a mesma chave devolve a mesma ordem. */
const porChave = new Map();
const recebidos = [];

function responde(res, status, corpo) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(corpo));
}

function erro(code, message) {
  return { errors: [{ code, message, details: [] }] };
}

function idNovo() {
  return `ORDTST${randomBytes(13).toString('hex').toUpperCase()}`;
}

/** Ordem e pagamento andam juntos aqui: uma ordem, um pagamento. */
function muda(ordem, status, detalhe) {
  ordem.status = status;
  ordem.status_detail = detalhe;
  const [pagamento] = ordem.transactions.payments;
  pagamento.status = status;
  pagamento.status_detail = detalhe;
}

/** O que o cartao de teste decide, pelo comeco do token. */
function cenarioDoCartao(token) {
  if (token.startsWith(CARTOES.recusado)) return [402, 'failed', 'rejected_by_issuer'];
  if (token.startsWith(CARTOES.semLimite)) return [201, 'failed', 'insufficient_amount'];
  if (token.startsWith(CARTOES.emAnalise)) return [201, 'processing', 'in_review'];
  if (token.startsWith(CARTOES.aprovado)) return [201, 'processed', 'accredited'];
  return null;
}

function criaOrdem(corpo) {
  const pedido = corpo?.transactions?.payments?.[0];
  const meio = pedido?.payment_method;
  if (!corpo?.external_reference || !corpo?.total_amount || !meio?.id) {
    return [400, erro('bad_request', 'campos obrigatorios')];
  }
  if (pedido.amount !== corpo.total_amount) {
    return [400, erro('invalid_total_amount', 'total diferente da soma dos pagamentos')];
  }

  const id = idNovo();
  const ordem = {
    id,
    type: 'online',
    processing_mode: corpo.processing_mode,
    external_reference: corpo.external_reference,
    total_amount: corpo.total_amount,
    created_date: new Date().toISOString(),
    status: 'created',
    status_detail: 'created',
    transactions: {
      payments: [
        {
          id: `PAYTST${randomBytes(13).toString('hex').toUpperCase()}`,
          amount: pedido.amount,
          status: 'created',
          status_detail: 'created',
          payment_method: { id: meio.id, type: meio.type },
        },
      ],
    },
  };

  if (meio.type === 'bank_transfer' && meio.id === 'pix') {
    muda(ordem, 'action_required', 'waiting_transfer');
    Object.assign(ordem.transactions.payments[0].payment_method, {
      qr_code: copiaECola(id),
      qr_code_base64: QR_DO_PIX,
    });
    ordens.set(id, ordem);
    return [201, ordem];
  }

  if (meio.type !== 'credit_card' || typeof meio.token !== 'string') {
    return [400, erro('unsupported_payment_method', 'meio que o falso nao conhece')];
  }

  const cenario = cenarioDoCartao(meio.token);
  if (!cenario) return [400, erro('invalid_card_token', 'token de cartao desconhecido')];

  const [status, situacao, detalhe] = cenario;
  muda(ordem, situacao, detalhe);
  ordens.set(id, ordem);
  return [status, ordem];
}

/** Cancelar so o que ainda esta aberto; estornar so o que foi pago. */
function opera(ordem, acao) {
  if (acao === 'cancel') {
    if (!['created', 'action_required', 'processing'].includes(ordem.status)) {
      return [409, erro('order_cannot_be_cancelled', `ordem ${ordem.status}`)];
    }
    muda(ordem, 'canceled', 'canceled');
    return [200, ordem];
  }

  if (ordem.status !== 'processed') {
    return [409, erro('order_cannot_be_refunded', `ordem ${ordem.status}`)];
  }
  muda(ordem, 'refunded', 'refunded');
  return [201, ordem];
}

/** As rotas do proprio falso, para o teste. Nunca existem do outro lado. */
function controle(req, res, url) {
  // O que o site mandou, e como o teste limpa entre um caso e outro.
  if (url.pathname === '/_recebidos') {
    if (req.method === 'DELETE') recebidos.length = 0;
    return responde(res, 200, recebidos);
  }

  // A pessoa pagou o Pix no app do banco: a ordem mais nova do pedido que
  // espera transferencia vira paga. O webhook NAO sai daqui: quem avisa o
  // site e o teste, quando quer — e assim da para testar o aviso que se perde.
  if (req.method === 'POST' && url.pathname === '/_paga') {
    const referencia = url.searchParams.get('referencia');
    const ordem = [...ordens.values()]
      .reverse()
      .find((o) => o.external_reference === referencia && o.status === 'action_required');
    if (!ordem) return responde(res, 404, erro('not_found', 'nenhum Pix esperando'));

    muda(ordem, 'processed', 'accredited');
    return responde(res, 200, { id: ordem.id });
  }

  return responde(res, 404, erro('not_found', 'rota de controle desconhecida'));
}

function trata(req, res, bruto) {
  const url = new URL(req.url ?? '/', 'http://falso');
  if (url.pathname.startsWith('/_')) return controle(req, res, url);

  let corpo = null;
  if (bruto.length > 0) {
    try {
      corpo = JSON.parse(bruto.toString('utf8'));
    } catch {
      return responde(res, 400, erro('bad_request', 'JSON invalido'));
    }
  }

  recebidos.push({
    metodo: req.method,
    caminho: `${url.pathname}${url.search}`,
    autorizacao: req.headers.authorization ?? null,
    idempotencia: req.headers['x-idempotency-key'] ?? null,
    corpo,
  });

  if (req.headers.authorization !== `Bearer ${TOKEN_DO_MP}`) {
    return responde(res, 401, erro('unauthorized', 'invalid access token'));
  }

  if (req.method === 'POST' && url.pathname === '/v1/orders') {
    // Obrigatoria na Orders API. Sem ela o de verdade recusa.
    const chave = req.headers['x-idempotency-key'];
    if (!chave) return responde(res, 400, erro('missing_idempotency_key', 'header obrigatorio'));

    const guardada = porChave.get(chave);
    if (guardada) return responde(res, guardada[0], guardada[1]);

    const resposta = criaOrdem(corpo);
    if (resposta[0] < 300 || resposta[0] === 402) porChave.set(chave, resposta);
    return responde(res, resposta[0], resposta[1]);
  }

  if (req.method === 'GET' && url.pathname === '/v1/orders') {
    const referencia = url.searchParams.get('external_reference');
    if (!referencia || !url.searchParams.get('begin_date') || !url.searchParams.get('end_date')) {
      return responde(res, 400, erro('bad_request', 'external_reference e janela obrigatorios'));
    }
    const data = [...ordens.values()].filter((o) => o.external_reference === referencia);
    return responde(res, 200, { data, paging: { total: data.length, offset: 0, limit: 50 } });
  }

  const m = /^\/v1\/orders\/([^/]+)(?:\/(cancel|refund))?$/.exec(url.pathname);
  const ordem = m ? ordens.get(decodeURIComponent(m[1])) : undefined;

  if (m && !ordem) return responde(res, 404, erro('order_not_found', 'ordem desconhecida'));
  if (m && req.method === 'GET' && !m[2]) return responde(res, 200, ordem);
  if (m && req.method === 'POST' && m[2]) {
    const [status, resposta] = opera(ordem, m[2]);
    return responde(res, status, resposta);
  }

  return responde(res, 404, erro('not_found', 'Not found'));
}

export function sobeMercadoPagoFalso() {
  const servidor = createServer((req, res) => {
    const pedacos = [];
    req.on('data', (p) => pedacos.push(p));
    req.on('end', () => trata(req, res, Buffer.concat(pedacos)));
  });

  servidor.listen(PORTA_DO_MP, '127.0.0.1');
  return servidor;
}
