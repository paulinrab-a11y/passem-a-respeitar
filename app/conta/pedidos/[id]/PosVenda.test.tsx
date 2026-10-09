import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CONTATO } from '@/lib/contato';
import { ARREPENDIMENTO_DIAS, GARANTIA_DIAS, posVendaDoPedido } from '@/lib/loja/termos';
import PosVenda from './PosVenda';

/**
 * "Precisa cancelar, desistir ou trocar?" (#276). O caminho do arrependimento
 * mora no pedido, e cada etapa diz so o que cabe nela. Data so aparece quando
 * o banco tem o dia da entrega.
 */
function bloco(status: string, entregueEm: string | null = null, agora?: Date) {
  const situacao = posVendaDoPedido(status, entregueEm, agora);
  if (!situacao) throw new Error(`${status} nao tem bloco`);
  return renderToStaticMarkup(<PosVenda situacao={situacao} numero={42} />).replace(/\s+/g, ' ');
}

describe('PosVenda', () => {
  it('sempre: o titulo, o e-mail com o numero no assunto, e o link dos termos', () => {
    const html = bloco('pago');

    expect(html).toContain('Precisa cancelar, desistir ou trocar?');
    expect(html).toContain(`href="mailto:${CONTATO}?subject=Pedido%20%2342"`);
    expect(html).toMatch(/com o número do pedido, #(<!-- -->)?42/);
    expect(html).toContain('href="/termos"');
  });

  it('aguardando pagamento: nada cobrado, e desistir e nao pagar', () => {
    expect(bloco('aguardando_pagamento')).toMatch(/Nada foi cobrado\. Se desistir, é só não pagar/);
  });

  it('pago ou em producao: cancela ate o envio, com tudo de volta', () => {
    for (const status of ['pago', 'em_producao']) {
      expect(bloco(status)).toMatch(/Até o envio, você pode cancelar e recebe de volta tudo/);
    }
  });

  // Sem dia de entrega, nenhuma data: a regra por extenso.
  it('enviado: a regra dos dias a partir do recebimento, sem data', () => {
    const html = bloco('enviado');

    expect(html).toMatch(/A camiseta já foi enviada\./);
    expect(html).toContain(`${ARREPENDIMENTO_DIAS} dias corridos`);
    expect(html).toContain(`garantia legal de ${GARANTIA_DIAS} dias`);
    expect(html).not.toMatch(/\d{2}\/\d{2}\/\d{4}/);
    expect(html).not.toContain('<time');
  });

  it('entregue sem o dia registrado: a mesma regra, sem data', () => {
    const html = bloco('entregue');

    expect(html).not.toMatch(/já foi enviada/);
    expect(html).toContain(`${ARREPENDIMENTO_DIAS} dias corridos`);
    expect(html).not.toContain('<time');
  });

  it('entregue com o dia: os tres prazos, com data de maquina e de gente', () => {
    const html = bloco('entregue', '2026-10-05T15:00:00Z', new Date('2026-10-06T15:00:00Z'));

    expect(html).toMatch(/Entregue em <time dateTime="2026-10-05">05\/10\/2026<\/time>/i);
    expect(html).toMatch(
      /Se a camiseta chegou depois, os prazos contam do dia em que você recebeu/
    );
    expect(html).toMatch(
      /<dt>Desistir da compra<\/dt><dd>até (<!-- -->)?<time dateTime="2026-10-12">12\/10\/2026/i
    );
    expect(html).toMatch(
      /<dt>Trocar o tamanho<\/dt><dd>até (<!-- -->)?<time dateTime="2026-10-12">/i
    );
    expect(html).toMatch(/<dt>Defeito<\/dt><dd>até (<!-- -->)?<time dateTime="2027-01-03">/i);
  });

  it('prazo vencido diz que encerrou, e quando', () => {
    const html = bloco('entregue', '2026-10-05T15:00:00Z', new Date('2026-10-20T15:00:00Z'));

    expect(html).toMatch(/<dt>Desistir da compra<\/dt><dd>encerrado em (<!-- -->)?<time/);
    expect(html).toMatch(/<dt>Defeito<\/dt><dd>até (<!-- -->)?<time/);
  });
});
