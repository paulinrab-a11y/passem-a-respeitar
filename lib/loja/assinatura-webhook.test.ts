import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { conferaAssinatura } from './assinatura-webhook';

/**
 * Este arquivo e o que separa "confirmacao do Mercado Pago" de "qualquer um da
 * internet marcando pedido como pago". Um erro aqui nao quebra nada — e ai
 * esta o problema.
 */

const SEGREDO = 'segredo-de-teste-nao-e-o-de-producao';
const AGORA = 1_760_000_000_000;

/** Assina como o provedor assinaria, para o teste nao depender do formato. */
function assina({
  recursoId = 'ORD01ABC',
  requestId = 'req-123',
  ts = String(AGORA),
  segredo = SEGREDO,
} = {}) {
  const id = /^\d+$/.test(recursoId) ? recursoId : recursoId.toLowerCase();
  const manifesto = `id:${id};request-id:${requestId};ts:${ts};`;
  const v1 = createHmac('sha256', segredo).update(manifesto).digest('hex');
  return { assinatura: `ts=${ts},v1=${v1}`, requestId, recursoId };
}

const confere = (extra: Record<string, unknown> = {}) =>
  conferaAssinatura({ ...assina(), segredos: { principal: SEGREDO }, agoraMs: AGORA, ...extra });

describe('assinatura valida', () => {
  it('aceita o que o provedor assinou', () => {
    expect(confere()).toEqual({ valida: true, origem: 'principal' });
  });

  it('a ordem dos campos no header nao importa', () => {
    const { assinatura, ...resto } = assina();
    const [ts, v1] = assinatura.split(',');

    expect(
      conferaAssinatura({
        ...resto,
        assinatura: `${v1}, ${ts}`,
        segredos: { principal: SEGREDO },
        agoraMs: AGORA,
      })
    ).toEqual({ valida: true, origem: 'principal' });
  });

  it('aceita o hash em maiuscula', () => {
    const a = assina();
    const emMaiuscula = a.assinatura.replace(/v1=(.+)$/, (_, h) => `v1=${h.toUpperCase()}`);

    expect(confere({ ...a, assinatura: emMaiuscula })).toEqual({
      valida: true,
      origem: 'principal',
    });
  });

  // Id alfanumerico vai em minuscula no manifesto, conforme a documentacao.
  it('normaliza id alfanumerico para minuscula', () => {
    const a = assina({ recursoId: 'ORD01ABC' });

    expect(confere({ ...a, recursoId: 'ORD01ABC' })).toEqual({ valida: true, origem: 'principal' });
  });

  it('id numerico fica como esta', () => {
    const a = assina({ recursoId: '123456789' });

    expect(confere({ ...a })).toEqual({ valida: true, origem: 'principal' });
  });

  // O provedor ja mandou em segundos; aceitar os dois evita recusar
  // notificacao legitima por causa de unidade.
  it('aceita carimbo em segundos', () => {
    const emSegundos = String(Math.floor(AGORA / 1000));
    const a = assina({ ts: emSegundos });

    expect(confere({ ...a })).toEqual({ valida: true, origem: 'principal' });
  });
});

describe('falha fechada', () => {
  // A alternativa — "deixa passar enquanto nao configurou" — e um endpoint
  // aberto esperando ser encontrado.
  it('sem segredo cadastrado, nada passa', () => {
    expect(confere({ segredos: { principal: undefined } })).toEqual({
      valida: false,
      motivo: 'sem-segredo',
    });
  });

  it('sem segredo recusa ATE uma assinatura que seria valida', () => {
    const a = assina();

    expect(conferaAssinatura({ ...a, segredos: { principal: '' }, agoraMs: AGORA }).valida).toBe(
      false
    );
  });

  it.each([
    ['sem header', { assinatura: null }, 'sem-assinatura'],
    ['sem id do recurso', { recursoId: null }, 'sem-id'],
    ['header sem v1', { assinatura: 'ts=123' }, 'assinatura-malformada'],
    ['header sem ts', { assinatura: 'v1=abc' }, 'assinatura-malformada'],
    ['header vazio de sentido', { assinatura: 'qualquer coisa' }, 'assinatura-malformada'],
    ['ts que nao e numero', { assinatura: 'ts=ontem,v1=abc' }, 'carimbo-invalido'],
    ['ts negativo', { assinatura: 'ts=-5,v1=abc' }, 'carimbo-invalido'],
  ])('recusa %s', (_caso, entrada, motivo) => {
    expect(confere(entrada)).toEqual({ valida: false, motivo });
  });
});

describe('assinatura forjada', () => {
  it('hash trocado nao passa', () => {
    const a = assina();
    const forjada = a.assinatura.replace(/v1=.+$/, `v1=${'0'.repeat(64)}`);

    expect(confere({ ...a, assinatura: forjada })).toEqual({
      valida: false,
      motivo: 'nao-confere',
    });
  });

  it('assinada com outro segredo nao passa', () => {
    const a = assina({ segredo: 'segredo-de-quem-esta-tentando' });

    expect(confere({ ...a })).toEqual({ valida: false, motivo: 'nao-confere' });
  });

  // O ataque util: assinar uma notificacao de um pedido e reapontar para outro.
  it('trocar o id do recurso invalida', () => {
    const a = assina({ recursoId: 'ORD-DO-VIZINHO' });

    expect(confere({ ...a, recursoId: 'ORD-MEU' })).toEqual({
      valida: false,
      motivo: 'nao-confere',
    });
  });

  it('trocar o request-id invalida', () => {
    const a = assina({ requestId: 'req-original' });

    expect(confere({ ...a, requestId: 'req-outro' })).toEqual({
      valida: false,
      motivo: 'nao-confere',
    });
  });

  it('hash de tamanho errado nao passa nem explode', () => {
    const a = assina();

    expect(confere({ ...a, assinatura: `ts=${AGORA},v1=abc` })).toEqual({
      valida: false,
      motivo: 'nao-confere',
    });
  });

  it('hash que nem e hexadecimal nao explode', () => {
    const a = assina();
    const naoHex = 'z'.repeat(64);

    expect(confere({ ...a, assinatura: `ts=${AGORA},v1=${naoHex}` })).toEqual({
      valida: false,
      motivo: 'nao-confere',
    });
  });
});

describe('replay', () => {
  // Sem limite de idade, uma notificacao legitima capturada hoje vale para
  // sempre: bastaria reenviar meses depois.
  it('recusa notificacao velha', () => {
    const a = assina();

    expect(confere({ ...a, agoraMs: AGORA + 10 * 60 * 1000 })).toEqual({
      valida: false,
      motivo: 'velha-demais',
    });
  });

  // Relogio adiantado do outro lado tambem e suspeito: notificacao do futuro
  // nao existe.
  it('recusa notificacao do futuro', () => {
    const a = assina();

    expect(confere({ ...a, agoraMs: AGORA - 10 * 60 * 1000 })).toEqual({
      valida: false,
      motivo: 'velha-demais',
    });
  });

  it.each([0, 60_000, 4 * 60_000, 5 * 60_000])('aceita atraso de %i ms', (atraso) => {
    const a = assina();

    expect(confere({ ...a, agoraMs: AGORA + atraso })).toEqual({
      valida: true,
      origem: 'principal',
    });
  });

  it('recusa um segundo depois do limite', () => {
    const a = assina();

    expect(confere({ ...a, agoraMs: AGORA + 5 * 60_000 + 1 }).valida).toBe(false);
  });
});

/**
 * O painel do provedor tem uma configuracao por modo, cada uma com o SEU
 * segredo, e as duas podem apontar para a mesma URL. Com um segredo so,
 * metade das notificacoes seria recusada por construcao — e a recusa
 * pareceria ataque, quando e configuracao.
 */
describe('dois segredos', () => {
  const OUTRO = 'segredo-da-outra-configuracao-do-painel';

  it('aceita o que foi assinado com o principal', () => {
    const a = assina({ segredo: SEGREDO });

    expect(
      conferaAssinatura({
        ...a,
        segredos: { principal: SEGREDO, alternativo: OUTRO },
        agoraMs: AGORA,
      })
    ).toEqual({ valida: true, origem: 'principal' });
  });

  it('aceita o que foi assinado com o alternativo', () => {
    const a = assina({ segredo: OUTRO });

    expect(
      conferaAssinatura({
        ...a,
        segredos: { principal: SEGREDO, alternativo: OUTRO },
        agoraMs: AGORA,
      })
    ).toEqual({ valida: true, origem: 'alternativo' });
  });

  // Sem isto o log nao serve para nada: saber QUE passou nao diz qual
  // configuracao do painel esta viva.
  it('diz qual dos dois fechou', () => {
    const doAlternativo = conferaAssinatura({
      ...assina({ segredo: OUTRO }),
      segredos: { principal: SEGREDO, alternativo: OUTRO },
      agoraMs: AGORA,
    });

    expect(doAlternativo).toMatchObject({ origem: 'alternativo' });
  });

  it('um terceiro segredo continua sem passar', () => {
    const a = assina({ segredo: 'segredo-de-quem-esta-tentando' });

    expect(
      conferaAssinatura({
        ...a,
        segredos: { principal: SEGREDO, alternativo: OUTRO },
        agoraMs: AGORA,
      })
    ).toEqual({ valida: false, motivo: 'nao-confere' });
  });

  // Aceitar dois nao pode virar aceitar qualquer um: cada barreira que nao e
  // o hash continua valendo igual.
  it('o alternativo nao escapa do limite de idade', () => {
    const a = assina({ segredo: OUTRO });

    expect(
      conferaAssinatura({
        ...a,
        segredos: { principal: SEGREDO, alternativo: OUTRO },
        agoraMs: AGORA + 10 * 60 * 1000,
      })
    ).toEqual({ valida: false, motivo: 'velha-demais' });
  });

  it('so o alternativo cadastrado ja basta', () => {
    const a = assina({ segredo: OUTRO });

    expect(
      conferaAssinatura({
        ...a,
        segredos: { principal: undefined, alternativo: OUTRO },
        agoraMs: AGORA,
      })
    ).toEqual({ valida: true, origem: 'alternativo' });
  });

  it('os dois vazios e falha fechada, como antes', () => {
    expect(
      conferaAssinatura({
        ...assina(),
        segredos: { principal: undefined, alternativo: '' },
        agoraMs: AGORA,
      })
    ).toEqual({ valida: false, motivo: 'sem-segredo' });
  });
});
