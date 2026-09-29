import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Pagina de nao encontrado (#173).
 *
 * Quem mede o console e o status e o teste de ponta a ponta. Este aqui roda
 * sem navegador e segura as duas coisas que alguem tiraria sem perceber o que
 * fez: a leitura que torna a pagina dinamica, e o texto que nao pode dizer de
 * que tipo era o endereco.
 */
const fonte = existsSync('app/not-found.tsx') ? readFileSync('app/not-found.tsx', 'utf8') : '';
const semComentario = fonte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

describe('pagina de nao encontrado', () => {
  it('existe: sem ela o Next mostra a dele, em ingles', () => {
    expect(fonte).not.toBe('');
  });

  it('e montada a cada pedido, para receber o nonce da CSP', () => {
    expect(semComentario).toMatch(/export default async function \w+\(\) \{\s*await headers\(\);/);
    expect(semComentario).toContain("import { headers } from 'next/headers';");
  });

  it('nao e client component: e o servidor que precisa monta-la', () => {
    expect(fonte).not.toMatch(/^'use client'/m);
  });

  it('fica fora de buscador', () => {
    expect(semComentario).toContain('robots: { index: false, follow: false }');
  });

  it('esta em portugues', () => {
    expect(semComentario).toContain('<h1>Página não encontrada</h1>');
    expect(semComentario).not.toMatch(/not found|could not be found/i);
  });

  it('tem caminho de volta', () => {
    expect(semComentario).toMatch(/<a className="btn" href="\/">/);
    expect(semComentario).toContain('href="/conta/pedidos"');
  });

  // A mesma pagina responde por pedido que nao existe e por pedido de outra
  // pessoa (#42, #160). O titulo nao pode contar que o endereco era de pedido.
  it('o titulo e o texto principal nao dizem de que tipo era o endereco', () => {
    const titulo = semComentario.match(/<h1>([^<]*)<\/h1>/)?.[1] ?? '';
    const nota = semComentario.match(/<p className="detalhe-nota">([\s\S]*?)<\/p>/)?.[1] ?? '';

    expect(titulo).not.toMatch(/pedido|conta|pagamento/i);
    expect(nota).not.toMatch(/pedido|conta|pagamento/i);
  });

  it('usa a moldura das telas de entrada, sem estilo novo', () => {
    expect(semComentario).toContain('<main className="auth">');
    expect(semComentario).toContain('<section className="auth-caixa">');
    expect(semComentario).not.toMatch(/style=\{/);
  });
});
