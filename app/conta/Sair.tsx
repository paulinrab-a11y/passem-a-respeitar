'use client';

import { useState, useTransition } from 'react';
import { sair, sairDeTodos } from './acoes';

/**
 * Sair, e sair de tudo.
 *
 * A segunda e destrutiva de um jeito que nao da para desfazer: derruba a
 * sessao de todos os aparelhos, inclusive o celular que a pessoa nao tem em
 * maos agora. Por isso pede confirmacao — e a confirmacao sai animada, nao
 * some de uma vez, porque desaparecimento instantaneo parece falha.
 *
 * Sem biblioteca de animacao: a saida e uma classe que dispara um keyframe, e
 * o desmonte espera o `animationend`. E o suficiente para um bloco; quando o
 * menu da #34 chegar, vale reavaliar.
 */
type Fase = 'parado' | 'confirmando' | 'saindo';

export default function Sair() {
  const [fase, setFase] = useState<Fase>('parado');
  const [pendente, comecar] = useTransition();

  return (
    <div className="conta-sair">
      <form action={() => comecar(() => void sair())}>
        <button type="submit" className={`btn${pendente ? ' carregando' : ''}`} disabled={pendente}>
          {pendente ? 'Saindo…' : 'Sair'}
        </button>
      </form>

      {fase === 'parado' ? (
        <button type="button" className="auth-link" onClick={() => setFase('confirmando')}>
          Sair de todos os dispositivos
        </button>
      ) : (
        <div
          className={`conta-confirma${fase === 'saindo' ? ' saindo' : ''}`}
          // Só desmonta quando a animação de saída termina. Sem isso, a de
          // entrada dispararia de novo se a pessoa reabrir no meio.
          onAnimationEnd={() => {
            if (fase === 'saindo') setFase('parado');
          }}
        >
          <p>
            Isso derruba a sessão em todos os aparelhos, inclusive nos que você não tem em mãos
            agora.
          </p>

          <div className="conta-confirma-acoes">
            <form action={() => comecar(() => void sairDeTodos())}>
              <button
                type="submit"
                className={`btn${pendente ? ' carregando' : ''}`}
                disabled={pendente}
              >
                {pendente ? 'Saindo…' : 'Sair de tudo'}
              </button>
            </form>

            <button
              type="button"
              className="auth-link"
              onClick={() => setFase('saindo')}
              disabled={pendente}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
