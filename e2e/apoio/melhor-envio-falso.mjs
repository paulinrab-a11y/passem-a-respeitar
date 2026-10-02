// Um Melhor Envio de mentira, nesta maquina, para a suite de ponta a ponta
// (Issue #199).
//
// O de verdade precisa de conta, de token e de rede, e responde preco que
// muda. Aqui a resposta e fixa e conhecida, e o servidor guarda o que recebeu:
// o teste confere o que o site mandou, alem do que ele mostrou.
//
// O formato e o da documentacao deles: POST /api/v2/me/shipment/calculate,
// token no Authorization, e uma lista de servicos com id, preco em texto e
// prazo em dias. Servico que nao atende o CEP vem com `error`.

import { createServer } from 'node:http';

export const PORTA_DO_FRETE = 46330;
export const TOKEN_DO_FRETE = 'token-da-suite';

/** CEPs com comportamento combinado. Qualquer outro tem PAC e SEDEX. */
export const CEPS = {
  /** O Melhor Envio recusa: CEP que nao existe. */
  inexistente: '99999999',
  /** So PAC: SEDEX nao atende o trecho. */
  soPac: '69999999',
  /** Erro do lado deles. */
  foraDoAr: '00000001',
};

const PAC = {
  id: 1,
  name: 'PAC',
  price: '23.50',
  custom_price: '23.50',
  delivery_time: 8,
  custom_delivery_time: 8,
};
const SEDEX = {
  id: 2,
  name: 'SEDEX',
  price: '45.90',
  custom_price: '45.90',
  delivery_time: 3,
  custom_delivery_time: 3,
};

const recebidos = [];

function responde(res, status, corpo) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(corpo));
}

export function sobeMelhorEnvioFalso() {
  const servidor = createServer((req, res) => {
    const pedacos = [];
    req.on('data', (p) => pedacos.push(p));
    req.on('end', () => {
      // O que o teste le, e como ele limpa entre um caso e outro.
      if (req.url === '/_recebidos') {
        if (req.method === 'DELETE') recebidos.length = 0;
        return responde(res, 200, recebidos);
      }

      if (req.method !== 'POST' || req.url !== '/api/v2/me/shipment/calculate') {
        return responde(res, 404, { message: 'Not found' });
      }

      let corpo;
      try {
        corpo = JSON.parse(Buffer.concat(pedacos).toString('utf8'));
      } catch {
        return responde(res, 400, { message: 'JSON invalido' });
      }

      recebidos.push({
        autorizacao: req.headers.authorization ?? null,
        agente: req.headers['user-agent'] ?? null,
        corpo,
      });

      if (req.headers.authorization !== `Bearer ${TOKEN_DO_FRETE}`) {
        return responde(res, 401, { message: 'Unauthenticated.' });
      }

      const destino = corpo?.to?.postal_code;
      if (destino === CEPS.inexistente) {
        return responde(res, 422, {
          message: 'The given data was invalid.',
          errors: { 'to.postal_code': ['invalido'] },
        });
      }
      if (destino === CEPS.foraDoAr) return responde(res, 500, { message: 'Server Error' });
      if (destino === CEPS.soPac) {
        return responde(res, 200, [
          PAC,
          { id: 2, name: 'SEDEX', error: 'Serviço indisponível para o trecho.' },
        ]);
      }

      return responde(res, 200, [
        PAC,
        SEDEX,
        { id: 3, name: '.Package', price: '19.00', delivery_time: 6 },
      ]);
    });
  });

  servidor.listen(PORTA_DO_FRETE, '127.0.0.1');
  return servidor;
}
