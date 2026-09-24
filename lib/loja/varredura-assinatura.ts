/**
 * VARREDURA TEMPORARIA — remover antes do merge (Issue #45).
 *
 * A notificacao real chega, e nenhuma das variacoes documentadas fecha. Ja
 * foram 72 combinacoes testadas uma a uma. Testar a proxima hipotese isolada
 * custa um deploy e cinco minutos cada.
 *
 * Entao aqui o espaco inteiro e varrido de uma vez: todo manifesto plausivel
 * montado a partir dos valores que a requisicao realmente traz, cruzado com
 * cada segredo e cada forma de chave. Sao alguns milhares de HMACs, o que em
 * CPU e nada.
 *
 * O que sai daqui e um nome de combinacao ou a certeza de que nenhuma fecha —
 * e "nenhuma" passa a significar "o segredo esta errado", sem mais ressalvas.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export type EntradaDaVarredura = {
  assinatura: string | null;
  requestId: string | null;
  recursoId: string | null;
  externalReference: string | null;
  tipo: string | null;
  corpoCru: string;
  segredos: (string | undefined)[];
};

function confere(chave: string | Buffer, mensagem: string, alvo: string): boolean {
  const esperado = createHmac('sha256', chave).update(mensagem).digest('hex');
  if (esperado.length !== alvo.length) return false;
  try {
    return timingSafeEqual(Buffer.from(esperado, 'hex'), Buffer.from(alvo, 'hex'));
  } catch {
    return false;
  }
}

export function varre({
  assinatura,
  requestId,
  recursoId,
  externalReference,
  tipo,
  corpoCru,
  segredos,
}: EntradaDaVarredura): string {
  if (!assinatura) return 'sem-assinatura';

  let ts = '';
  let v1 = '';
  for (const pedaco of assinatura.split(',')) {
    const i = pedaco.indexOf('=');
    if (i === -1) continue;
    const k = pedaco.slice(0, i).trim();
    const v = pedaco.slice(i + 1).trim();
    if (k === 'ts') ts = v;
    if (k === 'v1') v1 = v;
  }
  if (!ts || !v1) return 'header-malformado';

  const alvo = v1.toLowerCase();
  const id = recursoId ?? '';
  const req = requestId ?? '';
  const ext = externalReference ?? '';

  // Cada forma do id, porque a documentacao manda minuscular id alfanumerico e
  // nao e obvio se isso vale para o id de ordem.
  const ids: [string, string][] = [
    ['asis', id],
    ['lower', id.toLowerCase()],
    ['upper', id.toUpperCase()],
    ['ext', ext],
  ];

  const mensagens: [string, string][] = [];

  for (const [rotuloId, valorId] of ids) {
    const base = [
      ['padrao', `id:${valorId};request-id:${req};ts:${ts};`],
      ['sem-req', `id:${valorId};ts:${ts};`],
      ['sem-ponto', `id:${valorId};request-id:${req};ts:${ts}`],
      ['req-vazio', `id:${valorId};request-id:;ts:${ts};`],
      ['com-type', `id:${valorId};request-id:${req};ts:${ts};type:${tipo ?? ''};`],
      ['com-topic', `id:${valorId};request-id:${req};ts:${ts};topic:${tipo ?? ''};`],
      ['com-ext', `id:${valorId};request-id:${req};ts:${ts};external-reference:${ext};`],
      ['data-id', `data.id:${valorId};request-id:${req};ts:${ts};`],
      ['ordem-ts-1o', `ts:${ts};id:${valorId};request-id:${req};`],
      ['colado', `${valorId}${req}${ts}`],
      ['pontos', `id:${valorId}.request-id:${req}.ts:${ts}.`],
      ['so-id-ts', `${valorId}${ts}`],
    ] as [string, string][];
    for (const [nome, m] of base) mensagens.push([`${rotuloId}/${nome}`, m]);
  }

  // Alguns provedores assinam o CORPO, nao um manifesto de cabecalhos. Nunca
  // foi testado aqui e custa tres linhas.
  mensagens.push(
    ['corpo', corpoCru],
    ['ts.corpo', `${ts}.${corpoCru}`],
    ['ts+corpo', `${ts}${corpoCru}`],
    ['corpo+ts', `${corpoCru}${ts}`]
  );

  for (let s = 0; s < segredos.length; s++) {
    const bruto = segredos[s];
    if (!bruto) continue;
    const onde = s === 0 ? 'principal' : 'alternativo';

    for (const [comoTexto, texto] of [
      ['', bruto],
      ['+trim', bruto.trim()],
    ] as [string, string][]) {
      if (comoTexto && texto === bruto) continue;

      const formas: [string, string | Buffer][] = [
        ['texto', texto],
        ['hex', Buffer.from(texto, 'hex')],
        ['base64', Buffer.from(texto, 'base64')],
        ['hex-upper', Buffer.from(texto.toUpperCase(), 'hex')],
      ];

      for (const [forma, chave] of formas) {
        for (const [nome, mensagem] of mensagens) {
          if (confere(chave, mensagem, alvo)) {
            return `ACHOU -> ${onde}${comoTexto}/${forma}/${nome}`;
          }
        }
      }
    }
  }

  const quantas = mensagens.length * 4 * 2 * segredos.filter(Boolean).length;
  return `nada fecha em ~${quantas} combinacoes -> o segredo esta errado`;
}
