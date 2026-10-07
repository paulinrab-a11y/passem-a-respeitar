// @vitest-environment jsdom

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A tela do Pix depois de gerado (#250).
 *
 * A acao do servidor e trocada por um duble: o que se prova e o que a TELA
 * faz com cada resposta — o texto que ela mostra, o botao que confere, a
 * conferencia sozinha e para onde a pessoa vai.
 */
const acao = vi.hoisted(() => ({ confere: vi.fn() }));
// Um roteador so, estavel entre renders como o de verdade.
const roteador = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock('./acoes', () => ({ conferePagamento: acao.confere }));
vi.mock('next/navigation', () => ({ useRouter: () => roteador }));

import Pix, { CONFERE_A_CADA_MS, CONFERE_POR_MS } from './Pix';

const PEDIDO = '11111111-1111-4111-8111-111111111111';
const DO_PEDIDO = `/conta/pedidos/${PEDIDO}`;

let visivel: DocumentVisibilityState = 'visible';

const monta = () =>
  render(
    <Pix
      dados={{ copiaECola: '00020126...', qrBase64: null, expiraEm: null }}
      valor="R$ 120,00"
      pedido={PEDIDO}
    />
  );

const botao = (c: HTMLElement) =>
  [...c.querySelectorAll('button')].find((b) =>
    b.textContent?.includes('Conferir pagamento')
  ) as HTMLButtonElement;

/** Uma promessa que o teste resolve quando quer: o "enquanto confere". */
function adiada<T>() {
  let resolve!: (v: T) => void;
  const promessa = new Promise<T>((r) => {
    resolve = r;
  });
  return { promessa, resolve };
}

beforeEach(() => {
  visivel = 'visible';
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => visivel,
  });
  acao.confere.mockReset().mockResolvedValue('aguardando');
  roteador.push.mockClear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('o que a tela diz', () => {
  it('conta que confere sozinha, com os numeros do relogio de verdade', () => {
    const { container } = monta();
    const texto = container.textContent ?? '';

    expect(CONFERE_A_CADA_MS).toBe(10_000);
    expect(CONFERE_POR_MS).toBe(600_000);
    expect(texto).toContain('confere o pagamento a cada 10 segundos, por até 10 minutos');
    expect(texto).toContain('abre o pedido quando ele for confirmado');
  });

  // A promessa antiga: "o pedido muda de status aqui", e nada mudava.
  it('nao promete o que nao faz: nem status que muda aqui, nem e-mail', () => {
    const { container } = monta();
    const texto = container.textContent ?? '';

    expect(texto).not.toMatch(/muda de status aqui/i);
    expect(texto).toContain('Não enviamos e-mail de pedido');
  });

  it('tem o caminho para o pedido', () => {
    const { container } = monta();
    const link = [...container.querySelectorAll('a')].find((a) => a.textContent === 'Ver o pedido');

    expect(link?.getAttribute('href')).toBe(DO_PEDIDO);
  });

  it('o lugar do recado existe vazio, antes de qualquer conferencia', () => {
    const { container } = monta();
    const vaga = container.querySelector('.pix .erro-vaga') as HTMLElement;

    expect(vaga).not.toBeNull();
    expect(vaga.children).toHaveLength(0);
  });
});

describe('o botao Conferir pagamento', () => {
  it('enquanto confere: desabilitado, com carregando e o rotulo de acao', async () => {
    const espera = adiada<string>();
    acao.confere.mockReturnValue(espera.promessa);
    const { container } = monta();

    act(() => {
      fireEvent.click(botao(container));
    });

    const b = botao(container);
    expect(acao.confere).toHaveBeenCalledWith(PEDIDO);
    expect(b.disabled).toBe(true);
    expect(b.className).toContain('carregando');
    expect(b.querySelector('.rotulo-acao')?.hasAttribute('data-ativo')).toBe(true);

    await act(async () => {
      espera.resolve('aguardando');
    });

    expect(botao(container).disabled).toBe(false);
    expect(botao(container).className).not.toContain('carregando');
  });

  it('sem novidade: diz que ainda nao apareceu, como status, e fica', async () => {
    const { container } = monta();

    await act(async () => {
      fireEvent.click(botao(container));
    });

    const recado = container.querySelector('.erro-vaga [role="status"]');
    expect(recado?.textContent).toMatch(/ainda não apareceu/);
    expect(roteador.push).not.toHaveBeenCalled();
  });

  it('mudou: vai ao pedido', async () => {
    acao.confere.mockResolvedValue('mudou');
    const { container } = monta();

    await act(async () => {
      fireEvent.click(botao(container));
    });

    expect(roteador.push).toHaveBeenCalledWith(DO_PEDIDO);
    expect(roteador.push).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['sem-sessao', /O Pix continua valendo/],
    ['limite', /Espere um minuto/],
    ['falhou', /Não consegui conferir/],
  ])('%s: avisa como alerta e o QR fica', async (resposta, frase) => {
    acao.confere.mockResolvedValue(resposta);
    const { container } = monta();

    await act(async () => {
      fireEvent.click(botao(container));
    });

    expect(container.querySelector('.erro-vaga [role="alert"]')?.textContent).toMatch(frase);
    expect(container.querySelector('.pix-codigo input')).not.toBeNull();
    expect(roteador.push).not.toHaveBeenCalled();
  });

  it('rede caida no meio: o mesmo aviso de falha, sem excecao solta', async () => {
    acao.confere.mockRejectedValue(new Error('rede'));
    const { container } = monta();

    await act(async () => {
      fireEvent.click(botao(container));
    });

    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/Não consegui conferir/);
  });
});

describe('a conferencia sozinha', () => {
  const passa = (ms: number) =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });

  it('nao pergunta nada antes da primeira volta do relogio', () => {
    vi.useFakeTimers();
    monta();

    expect(acao.confere).not.toHaveBeenCalled();
  });

  it('confere a cada volta do relogio, com o id do pedido', async () => {
    vi.useFakeTimers();
    monta();

    await passa(CONFERE_A_CADA_MS);
    expect(acao.confere).toHaveBeenCalledTimes(1);
    expect(acao.confere).toHaveBeenCalledWith(PEDIDO);

    await passa(CONFERE_A_CADA_MS);
    expect(acao.confere).toHaveBeenCalledTimes(2);
  });

  it('sem novidade, nao mostra recado: ninguem pediu esta conferencia', async () => {
    vi.useFakeTimers();
    const { container } = monta();

    await passa(CONFERE_A_CADA_MS);

    expect(container.querySelector('.erro-vaga')?.children).toHaveLength(0);
  });

  it('com a aba escondida nao pergunta nada', async () => {
    vi.useFakeTimers();
    monta();
    visivel = 'hidden';

    await passa(CONFERE_A_CADA_MS * 3);

    expect(acao.confere).not.toHaveBeenCalled();
  });

  // Quem pagou no app do banco volta para a aba: e a hora de conferir.
  it('ao voltar para a aba confere na hora, sem esperar o relogio', async () => {
    vi.useFakeTimers();
    monta();
    visivel = 'hidden';
    await passa(CONFERE_A_CADA_MS / 2);

    visivel = 'visible';
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(acao.confere).toHaveBeenCalledTimes(1);
  });

  it('mudou: vai ao pedido e para de perguntar', async () => {
    vi.useFakeTimers();
    acao.confere.mockResolvedValue('mudou');
    monta();

    await passa(CONFERE_A_CADA_MS);
    expect(roteador.push).toHaveBeenCalledWith(DO_PEDIDO);

    await passa(CONFERE_A_CADA_MS * 3);
    expect(acao.confere).toHaveBeenCalledTimes(1);
    expect(roteador.push).toHaveBeenCalledTimes(1);
  });

  it('sem sessao: para de perguntar, e o QR fica', async () => {
    vi.useFakeTimers();
    acao.confere.mockResolvedValue('sem-sessao');
    const { container } = monta();

    await passa(CONFERE_A_CADA_MS * 3);

    expect(acao.confere).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.pix-codigo input')).not.toBeNull();
    expect(roteador.push).not.toHaveBeenCalled();
  });

  it('erro e rede caida nao param o relogio', async () => {
    vi.useFakeTimers();
    acao.confere.mockRejectedValueOnce(new Error('rede')).mockResolvedValueOnce('falhou');
    monta();

    await passa(CONFERE_A_CADA_MS * 3);

    expect(acao.confere).toHaveBeenCalledTimes(3);
  });

  it('uma pergunta por vez: resposta lenta nao empilha outra', async () => {
    vi.useFakeTimers();
    acao.confere.mockReturnValue(new Promise(() => {}));
    monta();

    await passa(CONFERE_A_CADA_MS * 3);

    expect(acao.confere).toHaveBeenCalledTimes(1);
  });

  it('para de perguntar depois do tempo que o texto promete', async () => {
    vi.useFakeTimers();
    monta();

    await passa(CONFERE_POR_MS);
    const ate = acao.confere.mock.calls.length;
    expect(ate).toBe(CONFERE_POR_MS / CONFERE_A_CADA_MS - 1);

    await passa(CONFERE_A_CADA_MS * 5);
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(acao.confere).toHaveBeenCalledTimes(ate);
  });

  it('sair da tela desliga o relogio', async () => {
    vi.useFakeTimers();
    const { unmount } = monta();

    unmount();
    await passa(CONFERE_A_CADA_MS * 3);
    document.dispatchEvent(new Event('visibilitychange'));

    expect(acao.confere).not.toHaveBeenCalled();
  });
});
