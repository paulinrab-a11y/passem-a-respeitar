import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import Privacidade from './page';

/**
 * A politica existe por causa da #109: a tela de pagamento passou a deixar o
 * Mercado Pago coletar dados do dispositivo. Se alguem um dia apagar essa
 * secao "para encurtar", a CSP continua liberando o fingerprint e o texto
 * deixa de contar — e este teste cai.
 */
describe('/privacidade', () => {
  const html = renderToStaticMarkup(<Privacidade />);

  it('conta que o Mercado Pago coleta dados do dispositivo, e so na tela de pagamento', () => {
    expect(html).toMatch(/dados do seu dispositivo/i);
    expect(html).toMatch(/Mercado Pago/);
    expect(html).toMatch(/só nessa tela/i);
  });

  it('diz que o cartao nunca passa pelos nossos servidores', () => {
    expect(html).toMatch(/nunca passam pelos nossos servidores/i);
  });

  it('cita a LGPD e os direitos', () => {
    expect(html).toMatch(/LGPD/);
    expect(html).toMatch(/apagar seus dados/i);
  });

  it('nao inventa data de atualizacao', () => {
    expect(html).not.toMatch(/última atualização|atualizado em/i);
  });
});
