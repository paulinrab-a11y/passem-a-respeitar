import { describe, expect, it } from 'vitest';
import { destinoSeguro, ehPagamento, ehRotaDeAuth, exigeSessao, precisaDeSessao } from './rotas';

describe('exigeSessao', () => {
  it.each(['/conta', '/conta/', '/conta/pedidos', '/conta/seguranca', '/conta/pedidos/abc'])(
    'protege %s',
    (rota) => {
      expect(exigeSessao(rota)).toBe(true);
    }
  );

  // `/contato` comeca com `/conta` — sem a barra no teste de prefixo, uma
  // pagina publica de contato cairia atras do login.
  it.each(['/', '/contato', '/conta-de-mentira', '/entrar', '/api/convite', '/merch'])(
    'deixa %s passar',
    (rota) => {
      expect(exigeSessao(rota)).toBe(false);
    }
  );
});

describe('ehRotaDeAuth', () => {
  // Quem chega em /redefinir-senha TEM sessao (a de recuperacao). Se a rota
  // contasse como "de auth", o middleware a mandaria para /conta antes de
  // trocar a senha. (#32)
  it('/redefinir-senha nao e rota de auth', () => {
    expect(ehRotaDeAuth('/redefinir-senha')).toBe(false);
  });

  it.each(['/entrar', '/criar-conta', '/recuperar-senha'])('reconhece %s', (rota) => {
    expect(ehRotaDeAuth(rota)).toBe(true);
  });

  it.each(['/', '/conta', '/entrar/extra'])('nao confunde %s', (rota) => {
    expect(ehRotaDeAuth(rota)).toBe(false);
  });
});

describe('precisaDeSessao', () => {
  // A home nao paga ida de rede ao Supabase. E a pagina que quase todo mundo
  // ve, e hoje ela responde em dezenas de milissegundos.
  it('deixa a home de fora', () => {
    expect(precisaDeSessao('/')).toBe(false);
  });

  it.each(['/conta/pedidos', '/entrar'])('inclui %s', (rota) => {
    expect(precisaDeSessao(rota)).toBe(true);
  });
});

describe('destinoSeguro', () => {
  it('aceita rota de conta', () => {
    expect(destinoSeguro('/conta/pedidos')).toBe('/conta/pedidos');
  });

  it('preserva a query', () => {
    expect(destinoSeguro('/conta/pedidos?pagina=2')).toBe('/conta/pedidos?pagina=2');
  });

  // A lista abaixo e o motivo de a defesa ser por permissao e nao por
  // proibicao. Cada linha e uma forma diferente de escrever "outro host", e
  // quem tenta enumerar todas esquece uma.
  it.each([
    ['endereco absoluto', 'https://site-que-imita.com'],
    ['sem esquema', 'site-que-imita.com'],
    ['barra dupla', '//site-que-imita.com'],
    ['contrabarra', '/\\site-que-imita.com'],
    ['barra e contrabarra', '/\\/site-que-imita.com'],
    ['contrabarra no meio', '/conta\\@site-que-imita.com'],
    ['javascript', 'javascript:alert(1)'],
    ['data', 'data:text/html,<script>alert(1)</script>'],
    ['tab no meio', '/\t/site-que-imita.com'],
    ['nova linha', '/conta\n/x'],
    ['nulo', '/conta\u0000/x'],
    ['vazio', ''],
    ['nulo mesmo', null],
    ['indefinido', undefined],
  ])('recusa %s e manda para /conta', (_nome, entrada) => {
    expect(destinoSeguro(entrada)).toBe('/conta');
  });

  // Rota interna legitima, mas fora da area de conta: nao e ataque, so nao e
  // destino de pos-login. Volta para /conta em vez de virar excecao.
  it.each(['/', '/merch', '/entrar', '/contato'])('recusa a rota interna %s', (rota) => {
    expect(destinoSeguro(rota)).toBe('/conta');
  });

  it('nunca devolve destino que nao exige sessao', () => {
    const entradas = [
      '/conta/pedidos',
      '/',
      '//evil.com',
      'https://evil.com',
      '/conta',
      '/contato',
      null,
    ];

    for (const entrada of entradas) {
      const saida = destinoSeguro(entrada);
      expect(exigeSessao(saida.split('?')[0])).toBe(true);
    }
  });
});

describe('checkout (#106)', () => {
  it('exige sessao', () => {
    expect(exigeSessao('/checkout')).toBe(true);
  });

  // Quem clica em Comprar deslogado tem que voltar para o checkout COM o
  // tamanho escolhido. Perder a escolha no meio do caminho e perder a venda.
  it('e destino valido depois do login, com a escolha preservada', () => {
    expect(destinoSeguro('/checkout?p=camiseta-cbac&tam=GG')).toBe(
      '/checkout?p=camiseta-cbac&tam=GG'
    );
  });

  it('nao vira porta para rota que nao exige sessao', () => {
    expect(destinoSeguro('/checkoutfalso')).toBe('/conta');
    expect(destinoSeguro('//evil.com/checkout')).toBe('/conta');
  });
});

describe('ehPagamento (#108)', () => {
  // E a unica rota do site que abre host externo na CSP. Errar para mais abre
  // o Mercado Pago onde nao precisa; errar para menos quebra o Brick.
  it('reconhece a tela de pagamento', () => {
    expect(ehPagamento('/checkout/pagamento/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee')).toBe(true);
  });

  it.each([
    '/checkout',
    '/checkout/pagamento',
    '/checkout/pagamentos/123',
    '/conta/pedidos/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    '/',
    '/entrar',
    '/checkoutfalso/pagamento/1',
  ])('nao abre host externo em %s', (caminho) => {
    expect(ehPagamento(caminho)).toBe(false);
  });

  it('a tela de pagamento tambem exige sessao', () => {
    expect(exigeSessao('/checkout/pagamento/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee')).toBe(true);
  });
});
