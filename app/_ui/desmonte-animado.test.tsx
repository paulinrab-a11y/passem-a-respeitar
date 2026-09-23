// @vitest-environment jsdom

import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDesmonteAnimado } from './desmonte-animado';

function Painel({ limiteMs }: { limiteMs?: number }) {
  const { montado, saindo, abrir, fechar, aoFimDaAnimacao } = useDesmonteAnimado(limiteMs);

  return (
    <div>
      <button type="button" onClick={abrir}>
        abrir
      </button>
      <button type="button" onClick={fechar}>
        fechar
      </button>
      {/* O `onAnimationEnd` de verdade fica no painel abaixo. Este botao existe
          para o teste chamar o mesmo callback sem depender do sistema de
          eventos sinteticos do React rodando em jsdom — que e encanamento do
          React, nao contrato deste hook. */}
      <button type="button" onClick={aoFimDaAnimacao}>
        fim da animacao
      </button>
      {montado ? (
        <div data-testid="painel" data-saindo={saindo} onAnimationEnd={aoFimDaAnimacao}>
          conteudo
        </div>
      ) : null}
    </div>
  );
}

const clique = (texto: string) => act(() => screen.getByText(texto).click());
const painel = () => screen.queryByTestId('painel');

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  // Sem globals do Vitest, a limpeza automatica da testing-library nao entra:
  // o DOM do teste anterior fica na pagina e as buscas acham dois de cada.
  cleanup();
  vi.useRealTimers();
});

describe('useDesmonteAnimado', () => {
  it('comeca desmontado', () => {
    render(<Painel />);
    expect(painel()).toBeNull();
  });

  it('abre', () => {
    render(<Painel />);
    clique('abrir');
    expect(painel()).not.toBeNull();
  });

  it('ao fechar, continua montado e marcado como saindo', () => {
    render(<Painel />);
    clique('abrir');
    clique('fechar');

    expect(painel()).not.toBeNull();
    expect(painel()?.dataset.saindo).toBe('true');
  });

  it('desmonta quando a animacao termina', () => {
    render(<Painel />);
    clique('abrir');
    clique('fechar');

    clique('fim da animacao');

    expect(painel()).toBeNull();
  });

  // O caso que me mordeu no navegador: a animacao ficou parada e o evento
  // nunca chegou. Sem o prazo, o painel ficaria na tela ate recarregar.
  it('desmonta pelo prazo mesmo se animationend nunca chegar', () => {
    render(<Painel limiteMs={300} />);
    clique('abrir');
    clique('fechar');

    expect(painel()).not.toBeNull();
    act(() => void vi.advanceTimersByTime(299));
    expect(painel()).not.toBeNull();

    act(() => void vi.advanceTimersByTime(2));
    expect(painel()).toBeNull();
  });

  // Clicar em fechar varias vezes nao pode empurrar o desmonte para frente.
  it('fechar repetido nao reinicia o prazo', () => {
    render(<Painel limiteMs={300} />);
    clique('abrir');

    clique('fechar');
    act(() => void vi.advanceTimersByTime(200));
    clique('fechar');
    clique('fechar');
    act(() => void vi.advanceTimersByTime(120));

    expect(painel()).toBeNull();
  });

  it('reabrir durante a saida cancela o prazo', () => {
    render(<Painel limiteMs={300} />);
    clique('abrir');
    clique('fechar');
    act(() => void vi.advanceTimersByTime(100));

    clique('abrir');
    act(() => void vi.advanceTimersByTime(500));

    // Se o prazo tivesse continuado, o painel teria sumido sozinho depois de
    // a pessoa reabrir — que e pior do que nao animar.
    expect(painel()).not.toBeNull();
    expect(painel()?.dataset.saindo).toBe('false');
  });

  it('animationend fora da saida nao desmonta', () => {
    render(<Painel />);
    clique('abrir');

    // A animacao de ENTRADA tambem dispara animationend.
    clique('fim da animacao');

    expect(painel()).not.toBeNull();
  });

  it('nao deixa timer vivo depois de desmontar o componente', () => {
    const { unmount } = render(<Painel limiteMs={300} />);
    clique('abrir');
    clique('fechar');

    unmount();
    // Sem o cleanup, isto chamaria setState num componente que nao existe.
    expect(() => act(() => void vi.advanceTimersByTime(500))).not.toThrow();
  });
});
