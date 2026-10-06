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

  // O mesmo para a protecao contra bot (#28): a CSP abre o iframe da
  // Cloudflare nas telas de formulario, e o texto conta isso.
  it('conta que a Cloudflare recebe dados do navegador, e em que telas', () => {
    expect(html).toMatch(/Turnstile, da Cloudflare/);
    expect(html).toMatch(/endereço IP/);
    expect(html).toMatch(/entrar, criar conta, recuperar senha e o campo de convite/);
    expect(html).toMatch(/só nessas telas/i);
    expect(html).toContain('https://www.cloudflare.com/pt-br/privacypolicy/');
  });

  // O frete (#199): o CEP sai do site, e o texto conta para onde e o que vai
  // junto. Nome e e-mail nao vao, e isso tambem e dito.
  it('conta que o CEP vai ao Melhor Envio, e o que nao vai', () => {
    expect(html).toMatch(/Melhor Envio/);
    expect(html).toMatch(/CEP de entrega/);
    expect(html).toMatch(/nem seu nome, nem seu e-mail/);
    expect(html).toContain('https://lwsa.tech/politicas/');
  });

  it('conta que o CEP vai ao ViaCEP, e so o CEP (#204)', () => {
    expect(html).toContain('https://viacep.com.br');
    expect(html).toMatch(/Vai só o CEP/);
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
