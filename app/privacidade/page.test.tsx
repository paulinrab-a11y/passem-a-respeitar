import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { COOKIE_CONVITE } from '@/lib/convite';
import { COOKIE_LEMBRAR, COOKIE_RECUPERACAO } from '@/lib/supabase/cookies';
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
    expect(html).toMatch(/entrar, criar conta e recuperar senha, o campo de convite e o concierge/);
    expect(html).toMatch(/só nesses formulários/i);
    expect(html).toMatch(/abre o concierge/);
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

  // O CPF passa pelo servidor a caminho do Mercado Pago (lib/loja/cobranca.ts)
  // e nao vai para a tabela pagamentos. Se um dia for guardado, este texto
  // deixa de ser verdade e precisa mudar junto. (#254)
  it('conta que o CPF passa pelo servidor so para chegar ao Mercado Pago', () => {
    expect(html).toMatch(/CPF/);
    expect(html).toMatch(/só para chegar ao Mercado Pago/);
    expect(html).toMatch(/não fica guardado aqui/);
    expect(html).toMatch(/se foi Pix ou\s+cartão/);
  });

  // O concierge (#191) manda a conversa ao Google (lib/concierge/gemini.ts).
  it('conta que o concierge manda a conversa ao Google e nao a guarda', () => {
    expect(html).toMatch(/<h2>Concierge<\/h2>/);
    expect(html).toMatch(/Gemini/);
    expect(html).toMatch(/últimas mensagens da conversa \(até oito\)/);
    expect(html).toMatch(/não guarda a conversa/);
    expect(html).toMatch(/não escreva no chat dado pessoal/);
    expect(html).toContain('https://policies.google.com/privacy');
    expect(html).toContain('https://ai.google.dev/gemini-api/terms');
  });

  // Os nomes vem das constantes: renomear um cookie sem mexer na politica
  // derruba o teste, em vez de deixar o texto apontando para um nome morto.
  it('lista os cookies do site pelo nome de verdade, e o CEP no navegador', () => {
    expect(html).toMatch(/Cookies e o que fica no seu navegador/);
    for (const nome of [COOKIE_LEMBRAR, COOKIE_RECUPERACAO, COOKIE_CONVITE]) {
      expect(html).toContain(nome);
    }
    expect(html).toContain('auth-token');
    expect(html).toContain('code-verifier');
    // Igual a CHAVE de app/_home/cep-lembrado.ts.
    expect(html).toContain('par_cep');
    expect(html).toMatch(/limpe os dados deste site/);
  });

  it('conta onde o site roda, a medicao de visitas e o rastreio de erro', () => {
    expect(html).toMatch(/Vercel Analytics e\s+Speed Insights/);
    expect(html).toMatch(/sem cookie e sem identificar você/);
    expect(html).toMatch(/Sentry/);
    expect(html).toMatch(/Supabase/);
  });

  it('cita a LGPD e os direitos', () => {
    expect(html).toMatch(/LGPD/);
    expect(html).toMatch(/apagar seus dados/i);
  });

  it('nao inventa data de atualizacao', () => {
    expect(html).not.toMatch(/última atualização|atualizado em/i);
  });
});
