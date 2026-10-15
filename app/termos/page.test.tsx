import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONTATO } from '@/lib/contato';
import { formataData } from '@/lib/datas';
import { PRAZO_DE_PRODUCAO_DIAS } from '@/lib/loja/prazo';
import {
  ARREPENDIMENTO_DIAS,
  CONSERTO_DIAS,
  GARANTIA_DIAS,
  RESPOSTA_DIAS_UTEIS,
  TERMOS_ATUALIZADOS_EM,
  TROCA_DE_TAMANHO_DIAS,
} from '@/lib/loja/termos';

vi.mock('@sentry/nextjs', () => ({ captureMessage: vi.fn(), flush: async () => true }));
vi.mock('@/lib/sentry/depois', () => ({ enviaDepois: vi.fn() }));

const { default: Termos, metadata } = await import('./page');

/**
 * Os termos de compra (#276). Cada secao responde a uma pergunta que a lei
 * manda responder, e o teste segura as que alguem poderia apagar "para
 * encurtar": quem vende, o arrependimento, o defeito, como pedir.
 *
 * Os numeros vem das constantes. Mudar um prazo em lib/loja/termos.ts sem
 * mexer no texto nao quebra nada: o texto le a constante. Escrever um numero
 * a mao no texto, sim — o teste procura a frase com o numero da constante.
 */

/** Inventados. Os dados de verdade so existem na Vercel. */
const VENDEDOR = {
  VENDEDOR_NOME: 'Loja de Teste Ltda',
  VENDEDOR_DOCUMENTO: '00.000.000/0001-00',
  VENDEDOR_ENDERECO: 'Rua de Teste, 1, Centro, Cidade - UF, 00000-000',
};

function html(env: Partial<typeof VENDEDOR> = {}) {
  for (const nome of Object.keys(VENDEDOR)) {
    vi.stubEnv(nome, env[nome as keyof typeof VENDEDOR] ?? '');
  }
  return renderToStaticMarkup(<Termos />);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('/termos', () => {
  const pagina = html(VENDEDOR);

  it('tem as secoes, na ordem de quem compra', () => {
    const titulos = [...pagina.matchAll(/<h2>([^<]+)<\/h2>/g)].map((m) => m[1]);

    expect(titulos).toEqual([
      'Quem vende',
      'O que você compra',
      'Pagamento',
      'Cancelar antes do envio',
      `Desistir em ${ARREPENDIMENTO_DIAS} dias`,
      'Produto com defeito',
      'Troca de tamanho',
      'Como pedir',
      'Lei e foro',
    ]);
  });

  // A conta e o detalhe do pedido apontam para estas ancoras.
  it.each(['quem-vende', 'arrependimento', 'defeito', 'troca', 'como-pedir'])(
    'tem a ancora #%s',
    (id) => {
      expect(pagina).toContain(`id="${id}"`);
    }
  );

  it('nomeia a base legal de cada regra', () => {
    expect(pagina).toMatch(/Decreto\s+7\.962\/2013, art\. 2º/);
    expect(pagina).toMatch(
      /Código de Defesa do Consumidor, art\. 49, e Decreto 7\.962\/2013, art\.\s+5º/
    );
    expect(pagina).toMatch(/Código de Defesa do Consumidor, art\. 26/);
    expect(pagina).toMatch(/\(art\. 18\)/);
    expect(pagina).toMatch(/\(art\. 101, I\)/);
  });

  it('o prazo de producao e o mesmo do resto do site', () => {
    expect(pagina).toContain(`leva pelo menos ${PRAZO_DE_PRODUCAO_DIAS} dias`);
  });

  it('os prazos saem das constantes', () => {
    const texto = pagina.replace(/\s+/g, ' ');
    expect(texto).toContain(
      `em até ${ARREPENDIMENTO_DIAS} dias corridos, contados do dia em que recebe`
    );
    expect(texto).toContain(
      `garantia legal de ${GARANTIA_DIAS} dias contra defeito, contados do recebimento`
    );
    expect(texto).toContain(`até ${CONSERTO_DIAS} dias para resolver`);
    expect(texto).toContain(`em até ${TROCA_DE_TAMANHO_DIAS} dias corridos do recebimento`);
    expect(texto).toContain(`até ${RESPOSTA_DIAS_UTEIS} dias úteis`);
  });

  // Feita sob encomenda, mas em tamanho padrao: nao e a excecao que alguns
  // leem no art. 49. O texto nao pode prometer menos que a lei.
  it('o arrependimento vale para a camiseta sob encomenda, e o frete volta junto', () => {
    expect(pagina).toMatch(/o direito de arrependimento vale do mesmo jeito/);
    expect(pagina).not.toMatch(/não se aplica|não vale para|exceto/i);
    expect(pagina).toMatch(/inclusive o frete da entrega/);
    expect(pagina).toMatch(/frete para devolver é por conta da loja/);
  });

  it('cancelar antes do envio devolve tudo, camiseta e frete', () => {
    expect(pagina).toMatch(/Até a camiseta ser enviada, você pode cancelar/);
    expect(pagina).toMatch(/tudo o que pagou<\/strong>, camiseta e\s+frete/);
  });

  it('defeito: trinta dias para resolver, e a escolha e de quem comprou', () => {
    expect(pagina).toMatch(/uma\s+camiseta nova, o dinheiro de volta ou um desconto proporcional/);
  });

  it('a troca de tamanho e cortesia, e diz quem paga cada frete', () => {
    expect(pagina).toMatch(/Além do que a lei manda/);
    expect(pagina).toMatch(
      /o frete para mandar a camiseta de volta é seu, e o do tamanho novo é da loja/
    );
  });

  it('o reembolso volta pelo mesmo meio, com o aviso da fatura do cartao', () => {
    expect(pagina).toMatch(/pelo mesmo meio de pagamento/);
    expect(pagina).toMatch(/até duas faturas/);
  });

  it('pagamento recusado e Pix vencido nao cobram, e o pedido fica', () => {
    expect(pagina).toMatch(/Pagamento recusado ou Pix vencido não cobra nada/);
    expect(pagina).toMatch(/O pedido continua salvo, aguardando\s+pagamento/);
  });

  it('o caminho para pedir e o e-mail de contato, com o numero do pedido', () => {
    expect(pagina).toContain(`href="mailto:${CONTATO}"`);
    expect(pagina).toContain('href="/conta/pedidos"');
    expect(pagina).toMatch(/com o número do pedido/);
  });

  // Nenhum e-mail sai do site por causa de pedido (#250). A confirmacao do
  // pedido de desistencia e a resposta ao e-mail da pessoa.
  it('nao promete e-mail automatico de pedido', () => {
    expect(pagina).toMatch(/O site não manda e-mail sozinho sobre pedidos/);
    expect(pagina).toMatch(/respondemos confirmando o recebimento/);
  });

  it('diz que o aceite fica guardado no pedido', () => {
    expect(pagina).toMatch(/o pedido guarda a\s+data e a hora desse aceite/);
  });

  // A data de lancamento do EP fica em sigilo ate o pre-save (#269). A unica
  // data da pagina e a da versao dos termos, e nenhum mes vai por extenso.
  it('a unica data e a da versao dos termos', () => {
    const datas = [...pagina.matchAll(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g)].map((m) => m[0]);

    expect(datas).toEqual([formataData(TERMOS_ATUALIZADOS_EM)]);
    expect(pagina).toContain(`dateTime="${TERMOS_ATUALIZADOS_EM.slice(0, 10)}"`);
    expect(pagina).not.toMatch(
      /janeiro|fevereiro|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro/i
    );
    expect(pagina).not.toMatch(/lançamento|pré-save/i);
  });

  it('indexavel, com titulo e descricao sem data', () => {
    expect(metadata.robots).toBeUndefined();
    expect(String(metadata.title)).toMatch(/^Termos de compra/);
    expect(String(metadata.description)).not.toMatch(/\d{1,2}\/\d{1,2}|\b20\d{2}\b/);
  });
});

describe('/termos: quem vende (Decreto 7.962/2013, art. 2º)', () => {
  it('com os tres dados, mostra nome, documento com rotulo, endereco e contato', () => {
    const pagina = html(VENDEDOR);

    expect(pagina).toContain(VENDEDOR.VENDEDOR_NOME);
    expect(pagina).toContain(`CNPJ ${VENDEDOR.VENDEDOR_DOCUMENTO}`);
    expect(pagina).toContain(VENDEDOR.VENDEDOR_ENDERECO);
    expect(pagina).not.toMatch(/estão sendo atualizados/);
  });

  it('com CPF, o rotulo e CPF', () => {
    const pagina = html({ ...VENDEDOR, VENDEDOR_DOCUMENTO: '000.000.000-00' });

    expect(pagina).toContain('CPF 000.000.000-00');
  });

  // Sem os tres, a secao avisa em vez de mostrar meia identificacao. Em
  // producao a venda trava junto: ver lib/loja/vendedor.ts.
  it.each([
    ['nenhum', {}],
    ['sem endereco', { ...VENDEDOR, VENDEDOR_ENDERECO: '' }],
  ])('%s: diz que os dados estao sendo atualizados, e da o contato', (_, env) => {
    const pagina = html(env);

    expect(pagina).toMatch(
      /Os dados de quem vende — nome, CPF ou CNPJ e endereço — estão sendo\s+atualizados/
    );
    expect(pagina).toContain(`href="mailto:${CONTATO}"`);
    expect(pagina).not.toContain(VENDEDOR.VENDEDOR_NOME);
    expect(pagina).not.toMatch(/undefined|null/);
  });
});
