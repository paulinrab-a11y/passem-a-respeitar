import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * O painel do dono ganhou esqueleto por streaming (#242), e com ele o mesmo
 * risco que o detalhe do pedido teve na #160: `notFound()` dentro do boundary
 * desenha a tela de 404 e responde 200. O e2e mede o status de verdade; este
 * aqui roda sem navegador e pega a regressao no momento em que alguem mover a
 * conferencia de papel para dentro do `<Suspense>`.
 *
 * E e a unica tela do site que le pedido alheio: o client administrativo so
 * pode nascer depois da conferencia, e a consulta so pode nomear coluna que
 * a tela mostra.
 */
const fonte = readFileSync('app/conta/admin/pedidos/page.tsx', 'utf8');

const pagina = fonte.slice(
  fonte.indexOf('export default async function PedidosAdmin'),
  fonte.indexOf('async function Painel(')
);
const dentroDoBoundary = fonte.slice(fonte.indexOf('async function Painel('));

describe('painel: quem decide o status e a pagina, nao o boundary', () => {
  it('as duas partes existem, e nesta ordem', () => {
    expect(pagina.length).toBeGreaterThan(0);
    expect(dentroDoBoundary.length).toBeGreaterThan(0);
  });

  it('sessao e papel sao conferidos antes da moldura', () => {
    const moldura = pagina.indexOf('return (');
    const sessao = pagina.indexOf('if (!usuario) redirect(ENTRAR);');
    const papel = pagina.indexOf('if (!ehAdmin(');
    const recusa = pagina.indexOf('notFound();');

    expect(sessao).toBeGreaterThan(-1);
    expect(papel).toBeGreaterThan(-1);
    expect(recusa).toBeGreaterThan(-1);
    expect(sessao).toBeLessThan(moldura);
    expect(papel).toBeLessThan(moldura);
    expect(recusa).toBeLessThan(moldura);
  });

  it('dentro do boundary ninguem decide 404 nem manda para o login', () => {
    expect(dentroDoBoundary).not.toMatch(/\bnotFound\(/);
    expect(dentroDoBoundary).not.toContain('redirect(ENTRAR)');
    expect(dentroDoBoundary).not.toContain('ehAdmin(');
  });

  it('o client que ve o banco inteiro so nasce depois da conferencia', () => {
    expect(pagina).not.toContain('clienteAdmin(');
    expect(dentroDoBoundary).toContain('const admin = clienteAdmin();');
  });

  it('o esqueleto e o unico fallback, e a lista e o ultimo bloco da caixa', () => {
    expect(pagina).toContain('<Suspense fallback={<EsqueletoAdmin />}>');
    expect(pagina).toMatch(/<\/Suspense>\s*<\/section>\s*<\/main>/);
  });
});

describe('painel: o que sai do banco', () => {
  const colunas = fonte.match(/const COLUNAS =\s*'([^']+)'/)?.[1] ?? '';

  it('a consulta nomeia as colunas', () => {
    expect(colunas.split(',').map((c) => c.trim())).toEqual(
      expect.arrayContaining(['id', 'numero', 'status', 'criado_em', 'total_centavos'])
    );
    expect(dentroDoBoundary).toContain('.select(COLUNAS)');
    expect(fonte).not.toMatch(/select\(\s*'\*'\s*\)/);
  });

  it('nenhuma coluna interna: dono, provedor, anonimizacao', () => {
    for (const interna of ['user_id', 'pagamento_id', 'pagamento_provedor', 'anonimizado_em']) {
      expect(colunas).not.toContain(interna);
    }
  });

  it('o endereco inteiro vem, porque e o que vai para a etiqueta', () => {
    for (const coluna of [
      'entrega_nome',
      'entrega_cep',
      'entrega_logradouro',
      'entrega_numero',
      'entrega_complemento',
      'entrega_bairro',
      'entrega_cidade',
      'entrega_uf',
    ]) {
      expect(colunas).toContain(coluna);
    }
  });
});

describe('painel: filtro e pagina vem da URL ja validados', () => {
  it('a URL passa pelo zod antes de encostar na consulta', () => {
    const leitura = dentroDoBoundary.indexOf('leBuscaAdmin(await searchParams)');
    const consulta = dentroDoBoundary.indexOf(".from('orders')");

    expect(leitura).toBeGreaterThan(-1);
    expect(leitura).toBeLessThan(consulta);
    // O `in()` recebe o que `statusDoFiltro` devolveu, nunca o texto da URL.
    expect(dentroDoBoundary).toContain("if (alvo) consulta = consulta.in('status', alvo);");
    expect(dentroDoBoundary).not.toMatch(/\.in\('status',\s*(?:filtro|status|searchParams)/);
  });

  it('uma linha a mais que a pagina diz se ha proxima, sem contar a tabela', () => {
    expect(dentroDoBoundary).toContain('.range(inicio, inicio + POR_PAGINA)');
    expect(dentroDoBoundary).not.toContain("count: 'exact'");
  });

  it('pagina vazia alem da primeira volta para a primeira do mesmo filtro', () => {
    expect(dentroDoBoundary).toContain(
      'if (pedidos.length === 0 && pagina > 1) redirect(urlDoPainel(filtro));'
    );
  });

  it('os contadores vem de uma RPC so, e a lista nao depende dela', () => {
    expect(dentroDoBoundary).toContain("admin.rpc('conta_pedidos_por_status')");
    expect(dentroDoBoundary).toMatch(/if \(contados\.error\) console\.warn\(/);
    expect(dentroDoBoundary).toContain('let contagem: Contagem | null = null;');
  });
});
