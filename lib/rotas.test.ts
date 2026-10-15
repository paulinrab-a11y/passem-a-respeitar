import { describe, expect, it } from 'vitest';
import {
  destinoSeguro,
  ehPagamento,
  ehRotaDeAuth,
  exigeSessao,
  hostCanonico,
  hostPrincipal,
  precisaDeSessao,
  temDesafio,
} from './rotas';

describe('exigeSessao', () => {
  it.each(['/conta', '/conta/', '/conta/pedidos', '/conta/seguranca', '/conta/pedidos/abc'])(
    'protege %s',
    (rota) => {
      expect(exigeSessao(rota)).toBe(true);
    }
  );

  // `/contato` comeca com `/conta` — sem a barra no teste de prefixo, uma
  // pagina publica de contato cairia atras do login. /termos (#276) tambem e
  // publica: quem ainda nao tem conta precisa ler antes de comprar.
  it.each(['/', '/contato', '/conta-de-mentira', '/entrar', '/api/convite', '/merch', '/termos'])(
    'deixa %s passar',
    (rota) => {
      expect(exigeSessao(rota)).toBe(false);
    }
  );
});

describe('temDesafio', () => {
  it.each(['/', '/entrar', '/criar-conta', '/recuperar-senha'])(
    '%s tem formulario publico',
    (rota) => {
      expect(temDesafio(rota)).toBe(true);
    }
  );

  // Igualdade, e nao prefixo: `/entrar-de-mentira` nao herda nada de `/entrar`.
  it.each([
    '/redefinir-senha',
    '/privacidade',
    '/conta',
    '/checkout',
    '/checkout/pagamento/abc',
    '/entrar/',
    '/entrar-de-mentira',
    '/api/convite',
    '',
  ])('%s nao tem', (rota) => {
    expect(temDesafio(rota)).toBe(false);
  });
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

describe('hostPrincipal (#141)', () => {
  const P = 'site.exemplo';

  it('em producao, host diferente do principal devolve o principal', () => {
    expect(hostPrincipal('production', P, 'alias.exemplo')).toBe(P);
  });

  it('no proprio principal devolve null', () => {
    expect(hostPrincipal('production', P, P)).toBeNull();
    expect(hostPrincipal('production', P, 'SITE.exemplo')).toBeNull();
  });

  it.each(['preview', 'development', '', undefined])('ambiente %s nao redireciona', (amb) => {
    expect(hostPrincipal(amb, P, 'alias.exemplo')).toBeNull();
  });

  it.each([
    undefined,
    '',
    '   ',
    'https://site.exemplo',
    'site.exemplo/caminho',
    'site.exemplo:443',
    'a@site.exemplo',
    'site..exemplo',
    '-site.exemplo',
    'semponto',
  ])('principal %s nao e host e nao redireciona', (valor) => {
    expect(hostPrincipal('production', valor, 'alias.exemplo')).toBeNull();
  });

  it('apara espaco e caixa do valor da variavel', () => {
    expect(hostPrincipal('production', '  Site.Exemplo ', 'alias.exemplo')).toBe(P);
  });
});

describe('hostCanonico (#54)', () => {
  it('o host do NEXT_PUBLIC_SITE_URL manda', () => {
    expect(hostCanonico('https://www.cbacoccupation.com.br', 'cbacoccupation.com.br')).toBe(
      'www.cbacoccupation.com.br'
    );
  });

  it('ignora caminho, barra final, porta e caixa do endereco', () => {
    expect(hostCanonico('https://WWW.Site.Exemplo/', 'x.exemplo')).toBe('www.site.exemplo');
    expect(hostCanonico('https://site.exemplo/conta?x=1', 'x.exemplo')).toBe('site.exemplo');
    expect(hostCanonico('http://localhost:3000', 'x.exemplo')).toBe('localhost');
  });

  it.each([undefined, '', '   '])('sem endereco (%j), vale a variavel da Vercel', (valor) => {
    expect(hostCanonico(valor, 'cbacoccupation.com.br')).toBe('cbacoccupation.com.br');
  });

  it.each(['nao-e-url', 'www.site.exemplo', 'ftp://site.exemplo', 'mailto:a@b.c'])(
    'endereco que nao e http(s) (%s) cai na reserva',
    (valor) => {
      expect(hostCanonico(valor, 'reserva.exemplo')).toBe('reserva.exemplo');
    }
  );

  it('sem nenhuma das duas, devolve undefined, e o hostPrincipal deixa passar', () => {
    expect(hostCanonico(undefined, undefined)).toBeUndefined();
    expect(hostPrincipal('production', hostCanonico(undefined, undefined), 'x.exemplo')).toBeNull();
  });
});
