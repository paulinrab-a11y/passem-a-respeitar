import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Solicitacao } from '@/lib/conta/pos-venda';
import { CONTATO } from '@/lib/contato';
import { ARREPENDIMENTO_DIAS, GARANTIA_DIAS, posVendaDoPedido } from '@/lib/loja/termos';
import PosVenda from './PosVenda';

// A acao de servidor nao roda aqui: o que se prova e o que o bloco oferece.
vi.mock('./acoes', () => ({ pedirPosVenda: vi.fn() }));

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
    expect(html).toMatch(/se aparecer com o uso, (<!-- -->)?90(<!-- -->)? dias a partir de quando/);
  });

  it('prazo vencido diz que encerrou, e quando', () => {
    const html = bloco('entregue', '2026-10-05T15:00:00Z', new Date('2026-10-20T15:00:00Z'));

    expect(html).toMatch(/<dt>Desistir da compra<\/dt><dd>encerrado em (<!-- -->)?<time/);
    expect(html).toMatch(/<dt>Defeito<\/dt><dd>até (<!-- -->)?<time/);
  });

  // Vicio oculto (CDC, art. 26, § 3º): o defeito que aparece com o uso conta
  // de quando aparece. A tela nunca diz que esse direito acabou.
  it('passados os noventa dias, defeito nao vira encerrado', () => {
    const html = bloco('entregue', '2026-10-05T15:00:00Z', new Date('2027-03-01T15:00:00Z'));

    expect(html).toMatch(/<dt>Desistir da compra<\/dt><dd>encerrado em/);
    expect(html).toMatch(/<dt>Trocar o tamanho<\/dt><dd>encerrado em/);
    expect(html).toMatch(/<dt>Defeito<\/dt><dd>até (<!-- -->)?<time dateTime="2027-01-03">/i);
    expect(html).toMatch(/se aparecer com o uso/);
    expect(html.match(/encerrado em/g)).toHaveLength(2);
  });

  it('sem o dia da entrega, a regra do defeito oculto tambem aparece', () => {
    expect(bloco('enviado')).toMatch(/o que só aparece com o uso conta a partir de quando aparece/);
  });
});

/** Pedir pelo site (#379): o botao do que cabe, e o que ja foi pedido no lugar dele. */
describe('PosVenda com os botoes', () => {
  const PEDIDO = '44444444-4444-4444-8444-444444444444';
  const html = (status: string, solicitacoes: Solicitacao[] = []) =>
    renderToStaticMarkup(
      <PosVenda
        situacao={posVendaDoPedido(status, null)}
        numero={42}
        pedido={PEDIDO}
        solicitacoes={solicitacoes}
      />
    ).replace(/\s+/g, ' ');

  const ABERTA: Solicitacao = {
    tipo: 'cancelamento',
    protocolo: 'PV-0000ABCD',
    criadoEm: '2026-10-15T22:00:00Z',
    resolvidaEm: null,
    mensagem: null,
  };

  it('pago: o botao de cancelar, e o e-mail como alternativa', () => {
    const h = html('pago');
    expect(h).toContain('>Pedir cancelamento</button>');
    expect(h).toMatch(/Se preferir, escreva para/);
  });

  it('enviado: nenhum botao, so o e-mail', () => {
    const h = html('enviado');
    expect(h).not.toContain('</button>');
    expect(h).toMatch(/Escreva para/);
  });

  it('com o cancelamento aberto: o protocolo no lugar do botao', () => {
    const h = html('pago', [ABERTA]);
    expect(h).not.toContain('>Pedir cancelamento</button>');
    expect(h).toContain('PV-0000ABCD');
    expect(h).toContain('aguardando a loja');
  });

  it('pedido reembolsado: so a lista, com a data em que encerrou', () => {
    const h = renderToStaticMarkup(
      <PosVenda
        situacao={null}
        numero={42}
        pedido={PEDIDO}
        solicitacoes={[{ ...ABERTA, resolvidaEm: '2026-10-16T12:00:00Z' }]}
      />
    );
    expect(h).toContain('encerrado em');
    expect(h).not.toContain('</button>');
  });
});
