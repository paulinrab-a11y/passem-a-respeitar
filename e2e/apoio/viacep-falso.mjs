// Um ViaCEP de mentira, nesta maquina, para a suite de ponta a ponta (#204).
//
// O de verdade e publico e gratuito, mas a suite nao depende de rede nem de
// servico de terceiro. O formato e o deles: GET /ws/{cep}/json/, com `erro`
// como texto "true" quando o CEP nao existe.

import { createServer } from 'node:http';

export const PORTA_DO_VIACEP = 46331;

/** CEPs com resposta combinada. Qualquer outro CEP e a Avenida Paulista. */
export const CEPS_DO_VIACEP = {
  /** Desconhecido: a pessoa digita o endereco. */
  desconhecido: '99999999',
  /** CEP geral: so cidade e UF. */
  geral: '69999000',
  /** O ViaCEP caiu. */
  foraDoAr: '00000002',
};

const PAULISTA = {
  cep: '01310-100',
  logradouro: 'Avenida Paulista',
  complemento: 'de 612 a 1510 - lado par',
  bairro: 'Bela Vista',
  localidade: 'São Paulo',
  uf: 'SP',
};

function responde(res, status, corpo) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(corpo));
}

export function sobeViaCepFalso() {
  const servidor = createServer((req, res) => {
    const m = /^\/ws\/(\d{8})\/json\/?$/.exec(req.url ?? '');
    if (req.method !== 'GET' || !m) return responde(res, 400, {});

    const cep = m[1];
    if (cep === CEPS_DO_VIACEP.desconhecido) return responde(res, 200, { erro: 'true' });
    if (cep === CEPS_DO_VIACEP.foraDoAr) return responde(res, 500, { message: 'caiu' });
    if (cep === CEPS_DO_VIACEP.geral) {
      return responde(res, 200, {
        cep: '69999-000',
        logradouro: '',
        bairro: '',
        localidade: 'Lábrea',
        uf: 'AM',
      });
    }
    return responde(res, 200, { ...PAULISTA, cep: `${cep.slice(0, 5)}-${cep.slice(5)}` });
  });

  servidor.listen(PORTA_DO_VIACEP, '127.0.0.1');
  return servidor;
}
