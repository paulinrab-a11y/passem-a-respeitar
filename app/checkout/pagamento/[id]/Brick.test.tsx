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
type Props = {
  onReady?: () => void;
  onError?: () => void;
  onSubmit?: (dados: { formData: unknown }) => Promise<unknown>;
};
const mp = vi.hoisted(() => ({ props: null as Props | null, init: vi.fn() }));
// Um roteador so, estavel entre renders como o de verdade: objeto novo a cada
// render faria o efeito do aviso rearmar o relogio sem parar.
const roteador = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock('@mercadopago/sdk-react', () => ({
  initMercadoPago: mp.init,
  Payment: (props: Props) => {
    mp.props = props;
    return <div data-testid="formulario-do-mp" />;
  },
}));
vi.mock('next/navigation', () => ({ useRouter: () => roteador }));

import Brick, { ESPERA_ANALISE_MS } from './Brick';

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
  roteador.push.mockClear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

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

/**
 * O que a tela faz com a resposta do servidor (#20). O envio do Brick e
 * acionado pela mao, com o `fetch` dublado: o que se prova e para onde a
 * pessoa vai, e o que ela le antes.
 */
describe('depois de enviar o pagamento', () => {
  const PEDIDO = '11111111-1111-4111-8111-111111111111';

  const servidorResponde = (corpo: unknown, status = 200) =>
    vi.stubGlobal('fetch', () =>
      Promise.resolve(
        new Response(JSON.stringify(corpo), {
          status,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );

  const envia = () =>
    mp.props?.onSubmit?.({ formData: { payment_method_id: 'master', token: 'tok12345678' } });

  it('aprovado vai direto para o pedido, sem aviso', async () => {
    servidorResponde({ estado: 'aprovado' });
    const { container } = monta();

    await act(async () => {
      await envia();
    });

    expect(roteador.push).toHaveBeenCalledWith(`/conta/pedidos/${PEDIDO}`);
    expect(container.querySelector('.brick-analise')).toBeNull();
  });

  // Em analise nao e aprovado. A pessoa ouve isso AQUI, antes de cair numa
  // pagina que diz "Aguardando pagamento" sem explicar.
  it('em analise mostra o aviso antes de ir ao pedido, e tira o formulario', async () => {
    vi.useFakeTimers();
    servidorResponde({ estado: 'pendente' });
    const { container } = monta();

    await act(async () => {
      await envia();
    });

    const aviso = container.querySelector('.brick-analise[role="status"]');
    expect(aviso?.textContent).toMatch(/Pagamento em análise/);
    expect(roteador.push).not.toHaveBeenCalled();
    // Sem formulario: a cobranca ja existe la, e um segundo envio abriria outra.
    expect(container.querySelector('.brick-pilha')).toBeNull();
    // Quem nao quer esperar tem o link.
    expect(aviso?.querySelector('a')?.getAttribute('href')).toBe(`/conta/pedidos/${PEDIDO}`);

    act(() => {
      vi.advanceTimersByTime(ESPERA_ANALISE_MS);
    });

    expect(roteador.push).toHaveBeenCalledWith(`/conta/pedidos/${PEDIDO}`);
  });

  it('sair da tela antes da hora desarma a ida automatica', async () => {
    vi.useFakeTimers();
    servidorResponde({ estado: 'pendente' });
    const { unmount } = monta();

    await act(async () => {
      await envia();
    });
    unmount();
    act(() => {
      vi.advanceTimersByTime(ESPERA_ANALISE_MS);
    });

    expect(roteador.push).not.toHaveBeenCalled();
  });

  it('Pix mostra o QR em vez de ir ao pedido', async () => {
    servidorResponde({
      estado: 'pendente',
      pix: { copiaECola: '00020126...', qrBase64: null, expiraEm: null },
    });
    const { container } = monta();

    await act(async () => {
      await envia();
    });

    expect(container.querySelector('.pix')).not.toBeNull();
    expect(container.querySelector('.brick-analise')).toBeNull();
    expect(roteador.push).not.toHaveBeenCalled();
  });

  // Recusa mantem o formulario vivo com o que a pessoa digitou: a promessa
  // rejeitada e o que diz isso ao Brick.
  it('recusado mostra o recado do servidor, fica na tela e nao navega', async () => {
    servidorResponde({ erro: 'O pagamento está indisponível no momento.' }, 502);
    const { container } = monta();

    await act(async () => {
      await expect(envia()).rejects.toThrow('recusado');
    });

    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'O pagamento está indisponível no momento.'
    );
    expect(container.querySelector('.brick-pilha')).not.toBeNull();
    expect(roteador.push).not.toHaveBeenCalled();
  });

  it('rede fora avisa e fica na tela', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('sem rede')));
    const { container } = monta();

    await act(async () => {
      await expect(envia()).rejects.toThrow('rede');
    });

    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/Tente de novo/);
    expect(roteador.push).not.toHaveBeenCalled();
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
