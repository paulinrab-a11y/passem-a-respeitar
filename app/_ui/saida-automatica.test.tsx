// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDesmonteAnimado } from './desmonte-animado';
import { TEMPO_NA_TELA, useSaidaAutomatica } from './saida-automatica';

type Aviso = { tom: 'ok' | 'erro' };

// O mesmo encaixe de TrocarSenha.tsx: o aviso chega, o toast abre, e a saida
// automatica chama o `fechar` do desmonte animado.
function Toast() {
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const { montado, abrir, fechar } = useDesmonteAnimado(300);
  const { pausar, retomar } = useSaidaAutomatica(aviso, montado, fechar);

  const avisa = (tom: Aviso['tom']) => {
    // Objeto novo a cada vez, como a server action devolve.
    setAviso({ tom });
    abrir();
  };

  return (
    <div>
      <button type="button" onClick={() => avisa('ok')}>
        avisa ok
      </button>
      <button type="button" onClick={() => avisa('erro')}>
        avisa erro
      </button>
      {montado ? (
        // biome-ignore lint/a11y/noStaticElementInteractions: espelha o toast real, que pausa no hover
        <div
          data-testid="toast"
          onMouseEnter={pausar}
          onMouseLeave={retomar}
          onFocus={pausar}
          onBlur={retomar}
        >
          <button type="button" onClick={fechar}>
            x
          </button>
        </div>
      ) : null}
    </div>
  );
}

const clique = (texto: string) => act(() => screen.getByText(texto).click());
const toast = () => screen.queryByTestId('toast');
const passa = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

// Depois do prazo de tela ainda vem o prazo do desmonte (300 ms aqui).
const SAIDA = 300;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useSaidaAutomatica', () => {
  it('o erro fica mais tempo na tela que o sucesso', () => {
    expect(TEMPO_NA_TELA.erro).toBeGreaterThan(TEMPO_NA_TELA.ok);
  });

  it('o sucesso sai sozinho', () => {
    render(<Toast />);
    clique('avisa ok');

    passa(TEMPO_NA_TELA.ok - 1);
    expect(toast()).not.toBeNull();

    passa(1 + SAIDA);
    expect(toast()).toBeNull();
  });

  // O defeito da #136: o erro so saia no "x" e ficava em cima do conteudo.
  it('o erro tambem sai sozinho', () => {
    render(<Toast />);
    clique('avisa erro');

    passa(TEMPO_NA_TELA.erro - 1);
    expect(toast()).not.toBeNull();

    passa(1 + SAIDA);
    expect(toast()).toBeNull();
  });

  it('nao sai enquanto o ponteiro esta em cima', () => {
    render(<Toast />);
    clique('avisa erro');

    passa(TEMPO_NA_TELA.erro - 1000);
    act(() => void fireEvent.mouseEnter(screen.getByTestId('toast')));
    passa(TEMPO_NA_TELA.erro * 3);

    expect(toast()).not.toBeNull();
  });

  it('nao sai enquanto o foco esta dentro', () => {
    render(<Toast />);
    clique('avisa erro');

    act(() => void fireEvent.focus(screen.getByText('x')));
    passa(TEMPO_NA_TELA.erro * 3);

    expect(toast()).not.toBeNull();
  });

  it('ao sair do toast, o prazo recomeca inteiro', () => {
    render(<Toast />);
    clique('avisa erro');

    passa(TEMPO_NA_TELA.erro - 1000);
    act(() => void fireEvent.mouseEnter(screen.getByTestId('toast')));
    act(() => void fireEvent.mouseLeave(screen.getByTestId('toast')));

    // Se continuasse de onde parou, sairia em 1 s.
    passa(TEMPO_NA_TELA.erro - 1);
    expect(toast()).not.toBeNull();

    passa(1 + SAIDA);
    expect(toast()).toBeNull();
  });

  it('um aviso novo reinicia o prazo do que ja esta na tela', () => {
    render(<Toast />);
    clique('avisa erro');
    passa(TEMPO_NA_TELA.erro - 1000);

    clique('avisa erro');
    passa(TEMPO_NA_TELA.erro - 1);
    expect(toast()).not.toBeNull();

    passa(1 + SAIDA);
    expect(toast()).toBeNull();
  });

  // Fechar no "x" desmonta o toast debaixo do ponteiro: o mouseleave nao vem.
  it('fechar com o ponteiro em cima nao deixa o proximo aviso pausado', () => {
    render(<Toast />);
    clique('avisa erro');
    act(() => void fireEvent.mouseEnter(screen.getByTestId('toast')));
    clique('x');
    passa(SAIDA);
    expect(toast()).toBeNull();

    clique('avisa erro');
    passa(TEMPO_NA_TELA.erro + SAIDA);

    expect(toast()).toBeNull();
  });
});
