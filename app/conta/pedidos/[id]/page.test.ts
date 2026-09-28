import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * O status 404 do pedido alheio (#160).
 *
 * Status HTTP so pode ser decidido antes de a resposta comecar, e a resposta
 * comeca na moldura. `notFound()` dentro do boundary desenha a tela certa e
 * responde 200. O teste de ponta a ponta (#10) mede o status de verdade; este
 * aqui roda sem navegador e pega a regressao no momento em que alguem move a
 * consulta de volta para dentro do `<Suspense>`.
 */
const fonte = readFileSync('app/conta/pedidos/[id]/page.tsx', 'utf8');

const pagina = fonte.slice(
  fonte.indexOf('export default async function DetalheDoPedido'),
  fonte.indexOf('async function Pedido(')
);
const dentroDoBoundary = fonte.slice(fonte.indexOf('async function Pedido('));

describe('detalhe do pedido: quem decide o status e a pagina, nao o boundary', () => {
  it('as duas partes existem, e nesta ordem', () => {
    expect(pagina.length).toBeGreaterThan(0);
    expect(dentroDoBoundary.length).toBeGreaterThan(0);
  });

  it('a pagina consulta o pedido antes de devolver a moldura', () => {
    const consulta = pagina.indexOf('await meuPedido(id)');
    const moldura = pagina.indexOf('return (');

    expect(consulta).toBeGreaterThan(-1);
    expect(consulta).toBeLessThan(moldura);
  });

  it('pedido nao achado vira notFound antes da moldura', () => {
    const recusa = pagina.indexOf("if (resultado.tipo === 'nao-achei') notFound();");

    expect(recusa).toBeGreaterThan(-1);
    expect(recusa).toBeLessThan(pagina.indexOf('return ('));
  });

  it('sem sessao vira redirect antes da moldura', () => {
    const recusa = pagina.indexOf("if (resultado.tipo === 'sem-sessao') redirect(ENTRAR);");

    expect(recusa).toBeGreaterThan(-1);
    expect(recusa).toBeLessThan(pagina.indexOf('return ('));
  });

  it('dentro do boundary ninguem decide status', () => {
    expect(dentroDoBoundary).not.toMatch(/\bnotFound\(/);
    expect(dentroDoBoundary).not.toMatch(/\bredirect\(/);
  });

  it('o boundary recebe o pedido ja conferido, e nao so o id', () => {
    expect(pagina).toContain('<Pedido id={id} lido={resultado.pedido} />');
  });
});
