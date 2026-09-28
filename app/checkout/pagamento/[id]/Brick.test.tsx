// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Lugar reservado do formulario de pagamento (#154).
 *
 * O formulario do Mercado Pago e trocado por um duble que entrega os dois
 * avisos que interessam: `onReady` e `onError`. O que se prova e o que a
 * NOSSA tela faz em volta dele.
 */
type Props = { onReady?: () => void; onError?: () => void };
const mp = vi.hoisted(() => ({ props: null as Props | null, init: vi.fn() }));

vi.mock('@mercadopago/sdk-react', () => ({
  initMercadoPago: mp.init,
  Payment: (props: Props) => {
    mp.props = props;
    return <div data-testid="formulario-do-mp" />;
  },
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

import Brick from './Brick';

const monta = () =>
  render(
    <Brick
      chavePublica="TEST-chave-publica-de-teste"
      valor={120}
      valorEscrito="R$ 120,00"
      email="pessoa@exemplo.invalid"
      pedido="11111111-1111-4111-8111-111111111111"
    />
  );

beforeEach(() => {
  mp.props = null;
  mp.init.mockClear();
});

afterEach(cleanup);

describe('antes de o formulario montar', () => {
  it('o lugar ja existe, com o esqueleto e o formulario na mesma celula', () => {
    const { container } = monta();
    const pilha = container.querySelector('.brick-pilha') as HTMLElement;

    expect(pilha).not.toBeNull();
    expect(pilha.hasAttribute('data-pronto')).toBe(false);
    expect(pilha.querySelector('.esq-brick')).not.toBeNull();
    expect(pilha.querySelector('.brick-form [data-testid="formulario-do-mp"]')).not.toBeNull();
  });

  it('quem ouve recebe um aviso; as barras ficam escondidas', () => {
    const { container } = monta();

    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      'Carregando as formas de pagamento…'
    );
    expect(container.querySelector('.esq-brick')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('o esqueleto tem o formato do formulario: titulo, dois meios e botao', () => {
    const { container } = monta();
    const esq = container.querySelector('.esq-brick') as HTMLElement;

    expect([...esq.children].map((c) => c.className.split(' ')[0])).toEqual([
      'esq-brick-titulo',
      'esq-brick-meios',
      'esq-brick-botao',
    ]);
    expect(esq.querySelectorAll('.esq-brick-meios > .esq')).toHaveLength(2);
    expect(esq.textContent).toBe('');
  });
});

describe('quando o formulario avisa que montou', () => {
  it('a pilha fica pronta e o aviso de carregamento sai', () => {
    const { container } = monta();

    act(() => mp.props?.onReady?.());

    expect(container.querySelector('.brick-pilha')?.hasAttribute('data-pronto')).toBe(true);
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it('o esqueleto continua no DOM: e ele que segura a altura da celula', () => {
    const { container } = monta();

    act(() => mp.props?.onReady?.());

    expect(container.querySelector('.esq-brick')).not.toBeNull();
  });
});

describe('quando o formulario falha', () => {
  it('o esqueleto para de dizer que esta carregando, e o erro aparece', () => {
    const { container } = monta();

    act(() => mp.props?.onError?.());

    expect(container.querySelector('.brick-pilha')?.hasAttribute('data-pronto')).toBe(true);
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/Recarregue/);
  });
});

describe('estilo do lugar reservado', () => {
  const css = readFileSync('app/globals.css', 'utf8');

  it('a altura reservada e a do formulario medido: 359px', () => {
    expect(css).toContain('.brick-pilha{display:grid;min-height:359px}');
    expect(css).toMatch(/\.esq-brick\{height:359px;/);
  });

  it('esqueleto e formulario ocupam a mesma celula', () => {
    expect(css).toContain('.brick-pilha>*{grid-area:1/1;min-width:0}');
  });

  it('formulario invisivel nao recebe clique', () => {
    expect(css).toMatch(/\.brick-form\{opacity:0;pointer-events:none;/);
    expect(css).toContain('.brick-pilha[data-pronto] .brick-form{opacity:1;pointer-events:auto}');
  });

  it('o esqueleto some sem sair do fluxo, e o brilho para', () => {
    expect(css).toContain('.brick-pilha[data-pronto] .esq-brick{opacity:0;visibility:hidden}');
    expect(css).toContain('.brick-pilha[data-pronto] .esq-brick .esq::after{animation:none}');
    expect(css).not.toMatch(/\.brick-pilha\[data-pronto\] \.esq-brick\{[^}]*display:none/);
  });

  it('a saida do esqueleto e mais curta que a entrada do formulario', () => {
    const sai = css.match(/\.esq-brick\{[^}]*transition:opacity ([\d.]+)s/)?.[1];
    const entra = css.match(/\.brick-form\{[^}]*transition:opacity ([\d.]+)s/)?.[1];

    expect(Number(sai)).toBeLessThan(Number(entra));
  });

  it('com movimento reduzido nao ha fade nem brilho', () => {
    expect(css).toMatch(
      /@media \(prefers-reduced-motion:reduce\)\{\s*\.brick-form,\.esq-brick\{transition:none\}\s*\.esq-brick\{animation:none\}/
    );
  });
});
