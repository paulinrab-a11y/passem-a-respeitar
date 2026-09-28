// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { cleanup, render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  EsqueletoPedido,
  EsqueletoPedidos,
  EsqueletoPerfil,
  EsqueletoSeguranca,
} from './Esqueletos';

/**
 * Esqueletos (#46). O que se prova aqui e o contrato, nao o desenho:
 *
 *   - quem ouve a pagina recebe UM aviso de carregamento, e nenhuma barra
 *   - nenhum texto de verdade aparece antes do dado chegar
 *   - cada esqueleto usa as classes do conteudo que substitui, que e o que
 *     faz o espaco reservado acompanhar o CSS em vez de uma medida copiada
 *   - em toda pagina o esqueleto e o ultimo bloco: nada abaixo dele se move
 */
const CASOS: [string, () => ReactElement, string[]][] = [
  ['perfil', EsqueletoPerfil, ['conta-topo', 'conta-foto', 'conta-nome', 'conta-atalho']],
  [
    'lista de pedidos',
    EsqueletoPedidos,
    ['pedidos', 'pedido-topo', 'pedido-itens', 'pedido-total'],
  ],
  [
    'detalhe do pedido',
    EsqueletoPedido,
    ['detalhe-topo', 'detalhe-bloco', 'etapas', 'pedido-total'],
  ],
  ['segurança', EsqueletoSeguranca, ['conta-bloco', 'troca-email', 'sessoes', 'excluir']],
];

afterEach(cleanup);

describe.each(CASOS)('esqueleto de %s', (_nome, Esqueleto, classes) => {
  it('anuncia o carregamento uma vez e esconde as barras de quem ouve', () => {
    const { container } = render(<Esqueleto />);
    const raiz = container.firstElementChild as HTMLElement;

    expect(raiz.getAttribute('role')).toBe('status');
    expect(raiz.getAttribute('aria-busy')).toBe('true');
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);

    const aviso = raiz.querySelector('.sr');
    expect(aviso?.textContent).toMatch(/^Carregando .+…$/);

    const barras = raiz.querySelector('[aria-hidden="true"]') as HTMLElement;
    expect(barras).not.toBeNull();
    expect(barras.querySelectorAll('.esq, .esq-linha').length).toBeGreaterThan(3);
  });

  it('nao mostra texto nenhum alem do aviso', () => {
    const { container } = render(<Esqueleto />);
    const barras = container.querySelector('[aria-hidden="true"]') as HTMLElement;

    // So espaco: o espaco nao separavel e o que da altura de linha a barra.
    expect(barras.textContent?.replace(/[\s ]/g, '')).toBe('');
  });

  it('nao tem nada clicavel nem focavel', () => {
    const { container } = render(<Esqueleto />);

    expect(container.querySelectorAll('a, button, input, [tabindex]')).toHaveLength(0);
  });

  it.each(classes)('usa a classe %s do conteudo real', (classe) => {
    const { container } = render(<Esqueleto />);

    expect(container.querySelector(`.${classe}`)).not.toBeNull();
  });
});

describe('o esqueleto e o ultimo bloco da pagina', () => {
  const PAGINAS: [string, string][] = [
    ['app/conta/page.tsx', 'EsqueletoPerfil'],
    ['app/conta/pedidos/page.tsx', 'EsqueletoPedidos'],
    ['app/conta/pedidos/[id]/page.tsx', 'EsqueletoPedido'],
    ['app/conta/seguranca/page.tsx', 'EsqueletoSeguranca'],
  ];

  it.each(PAGINAS)('%s', (arquivo, esqueleto) => {
    const fonte = readFileSync(arquivo, 'utf8');

    expect(fonte).toContain(`<Suspense fallback={<${esqueleto} />}>`);
    // Nada entre o fim do boundary e o fim da caixa. Um bloco ali seria
    // empurrado quando o conteudo chegasse com altura diferente do esqueleto.
    expect(fonte).toMatch(/<\/Suspense>\s*<\/section>\s*<\/main>/);
    expect(fonte.match(/<Suspense/g)).toHaveLength(1);
  });
});

describe('estilo dos esqueletos', () => {
  const css = readFileSync('app/globals.css', 'utf8');

  it('o brilho anima so transform', () => {
    const brilho = css.match(/@keyframes esq-brilho\{([^}]*\{[^}]*\})\}/)?.[1] ?? '';

    expect(brilho).toContain('transform');
    expect(brilho).not.toMatch(/background|width|left/);
  });

  it('a entrada tem atraso, para consulta rapida nao piscar esqueleto', () => {
    expect(css).toMatch(
      /\.auth-caixa>\.esqueleto\{animation:esq-aparece [\d.]+s cubic-bezier\([\d.,]+\) \.1\d*s backwards\}/
    );
  });

  it('listas dentro do esqueleto nao herdam a entrada em cascata do conteudo', () => {
    expect(css).toContain(
      '.esqueleto .pedidos>li,.esqueleto .etapas li,.esqueleto .sessoes li{animation:none}'
    );
  });
});

describe('galeria da merch', () => {
  it('as molduras saem do servidor, uma por foto', () => {
    const fonte = readFileSync('app/page.tsx', 'utf8');

    expect(fonte).toMatch(
      /id="galeriaMerch"[^>]*>\s*\{CONFIG\.merchFotos\.map\(\(foto\) => \(\s*<figure key=\{foto\} aria-hidden="true" \/>/
    );
  });

  it('erro de imagem tambem encerra o brilho', () => {
    const script = readFileSync('app/_home/legacy-site.js', 'utf8');

    expect(script).toContain("img.addEventListener('error', pronto, {once:true})");
  });
});
