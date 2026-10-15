import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * O detalhe do pedido visto pelo dono (#345). Le pedido alheio com o client
 * administrativo, entao a ordem importa como no painel (#160, #242): papel
 * conferido antes da moldura e antes do client nascer, e a consulta nomeando
 * so o que a tela mostra. O e2e mede o 404 de verdade; este pega a regressao
 * sem navegador.
 */
const fonte = readFileSync('app/conta/admin/pedidos/[id]/page.tsx', 'utf8');
const pagina = fonte.slice(fonte.indexOf('export default async function PedidoAdmin'));
const colunas = fonte.match(/const COLUNAS =\s*'([^']+)'/)?.[1] ?? '';

describe('detalhe do dono: quem pode ver', () => {
  it('sessao, papel e id antes do client administrativo e da moldura', () => {
    const sessao = pagina.indexOf('if (!usuario) redirect(ENTRAR);');
    const papel = pagina.indexOf('if (!ehAdmin(');
    const id = pagina.indexOf('if (!pareceUuid(id)) notFound();');
    const client = pagina.indexOf('const admin = clienteAdmin();');
    const moldura = pagina.indexOf('return (');

    for (const marco of [sessao, papel, id, client, moldura]) expect(marco).toBeGreaterThan(-1);
    expect(sessao).toBeLessThan(papel);
    expect(papel).toBeLessThan(client);
    expect(id).toBeLessThan(client);
    expect(client).toBeLessThan(moldura);
  });

  it('pedido que nao existe e 404 antes da moldura', () => {
    expect(pagina.indexOf('if (!data) notFound();')).toBeLessThan(pagina.indexOf('return ('));
  });

  it('sem Suspense: quem decide o 404 e o banco, antes do primeiro byte', () => {
    expect(fonte).not.toMatch(/import \{[^}]*Suspense/);
  });

  it('noindex', () => {
    expect(fonte).toContain('robots: { index: false, follow: false }');
  });
});

describe('detalhe do dono: o que sai do banco', () => {
  it('itens, trilha com autor e motivo, e tentativas com o detalhe do provedor', () => {
    expect(colunas).toContain('order_items(');
    expect(colunas).toMatch(/order_status_history\([^)]*autor[^)]*motivo/);
    expect(colunas).toMatch(/pagamentos\([^)]*estado[^)]*provedor_status_detail/);
  });

  it('nada que mexa numa cobranca: chave de idempotencia e id do provedor ficam no banco', () => {
    expect(colunas).not.toContain('idempotency_key');
    expect(colunas).not.toContain('provedor_pagamento_id');
    expect(colunas).not.toContain('pagamento_id');
    expect(fonte).not.toMatch(/select\(\s*'\*'\s*\)/);
  });
});
