// @vitest-environment jsdom

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fimDaAnimacao } from './fim-da-animacao';
import Mensagem from './Mensagem';

/**
 * Saida das mensagens (#155).
 *
 * O jsdom nao anima: `animationend` so chega se o teste mandar. E o que deixa
 * testar os dois fins da saida em separado — o evento e o prazo.
 */

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const erro = (texto: string | null, chave: number, enviando = false) => (
  <Mensagem texto={texto} chave={chave} classe="auth-erro" papel="alert" enviando={enviando} />
);

const p = (container: HTMLElement) => container.querySelector('p');

describe('entrada', () => {
  it('sem texto nao desenha nada', () => {
    const { container } = render(erro(null, 0));

    expect(container.children).toHaveLength(0);
  });

  it('com texto, o paragrafo ja esta no primeiro render, sem classe de saida', () => {
    const { container } = render(erro('Confira o e-mail.', 1));

    expect(p(container)?.className).toBe('auth-erro');
    expect(p(container)?.getAttribute('role')).toBe('alert');
    expect(p(container)?.textContent).toBe('Confira o e-mail.');
  });

  it('de nada para uma mensagem nao ha o que esperar sair', () => {
    const { container, rerender } = render(erro(null, 0));

    rerender(erro('Confira o e-mail.', 1));

    expect(p(container)?.className).toBe('auth-erro');
  });
});

describe('saida', () => {
  it('mensagem que deixa de valer continua na tela, saindo', () => {
    const { container, rerender } = render(erro('Errou.', 1));

    rerender(erro(null, 1));

    expect(p(container)?.textContent).toBe('Errou.');
    expect(p(container)?.className).toBe('auth-erro saindo');
  });

  it('o fim da animacao tira a mensagem', () => {
    const { container, rerender } = render(erro('Errou.', 1));
    rerender(erro(null, 1));

    fimDaAnimacao(p(container) as HTMLElement);

    expect(p(container)).toBeNull();
  });

  it('sem `animationend`, o prazo tira: mensagem velha nao fica presa', () => {
    const { container, rerender } = render(erro('Errou.', 1));
    rerender(erro(null, 1));

    act(() => {
      vi.advanceTimersByTime(199);
    });
    expect(p(container)).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(p(container)).toBeNull();
  });

  it('o envio tira o erro do envio anterior', () => {
    const { container, rerender } = render(erro('Errou.', 1));

    rerender(erro('Errou.', 1, true));

    expect(p(container)?.className).toBe('auth-erro saindo');
  });

  it('a resposta com o mesmo erro traz a mensagem de volta, como paragrafo novo', () => {
    const { container, rerender } = render(erro('Errou.', 1));
    const primeiro = p(container);

    rerender(erro('Errou.', 1, true));
    fimDaAnimacao(primeiro as HTMLElement);
    expect(p(container)).toBeNull();

    rerender(erro('Errou.', 2));

    expect(p(container)).not.toBe(primeiro);
    expect(p(container)?.className).toBe('auth-erro');
  });
});

describe('troca', () => {
  it('a antiga sai antes de a nova entrar: nunca as duas juntas', () => {
    const { container, rerender } = render(erro('Primeira.', 1));

    rerender(erro('Segunda.', 2));

    expect(container.querySelectorAll('p')).toHaveLength(1);
    expect(p(container)?.textContent).toBe('Primeira.');
    expect(p(container)?.className).toBe('auth-erro saindo');

    fimDaAnimacao(p(container) as HTMLElement);

    expect(container.querySelectorAll('p')).toHaveLength(1);
    expect(p(container)?.textContent).toBe('Segunda.');
    expect(p(container)?.className).toBe('auth-erro');
  });

  it('se mudar de novo no meio da saida, entra a ultima', () => {
    const { container, rerender } = render(erro('Primeira.', 1));

    rerender(erro('Segunda.', 2));
    rerender(erro('Terceira.', 3));
    fimDaAnimacao(p(container) as HTMLElement);

    expect(p(container)?.textContent).toBe('Terceira.');
  });

  it('se o alvo voltar a ser o que esta na tela, a saida e cancelada', () => {
    const { container, rerender } = render(erro('Errou.', 1));
    const primeiro = p(container);

    rerender(erro('Errou.', 1, true));
    expect(p(container)?.className).toBe('auth-erro saindo');

    rerender(erro('Errou.', 1));

    expect(p(container)).toBe(primeiro);
    expect(p(container)?.className).toBe('auth-erro');

    // E o prazo antigo nao tira a mensagem depois.
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(p(container)).toBe(primeiro);
  });

  it('o fim da animacao de um filho nao conta como fim da saida', () => {
    const { container, rerender } = render(
      <div>
        <Mensagem texto="Errou." chave={1} classe="auth-erro" papel="alert" />
      </div>
    );
    rerender(
      <div>
        <Mensagem texto={null} chave={1} classe="auth-erro" papel="alert" />
      </div>
    );

    const alvo = p(container) as HTMLElement;
    const filho = document.createElement('span');
    alvo.appendChild(filho);
    fimDaAnimacao(filho);

    expect(p(container)).not.toBeNull();
  });

  it('o tom muda junto com a mensagem, e nao antes', () => {
    const { container, rerender } = render(
      <Mensagem texto="Deu certo." chave={1} classe="conta-recado ok" papel="status" />
    );

    rerender(<Mensagem texto="Deu errado." chave={2} classe="conta-recado erro" papel="alert" />);

    // Ainda a antiga, com o tom e o papel DELA.
    expect(p(container)?.className).toBe('conta-recado ok saindo');
    expect(p(container)?.getAttribute('role')).toBe('status');

    fimDaAnimacao(p(container) as HTMLElement);

    expect(p(container)?.className).toBe('conta-recado erro');
    expect(p(container)?.getAttribute('role')).toBe('alert');
  });
});
