'use client';

import { useTransition } from 'react';
import { useDesmonteAnimado } from '@/app/_ui/desmonte-animado';
import Rotulo from '@/app/_ui/Rotulo';
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
export default function Sair() {
  const { montado: confirmando, saindo, abrir, fechar, aoFimDaAnimacao } = useDesmonteAnimado(300);
  const [pendente, comecar] = useTransition();

  return (
    <div className="conta-sair">
      <form action={() => comecar(() => void sair())}>
        <button type="submit" className={`btn${pendente ? ' carregando' : ''}`} disabled={pendente}>
          <Rotulo parado="Sair" agindo="Saindo…" ativo={pendente} />
        </button>
      </form>

      {confirmando ? (
        <div
          className={`conta-confirma${saindo ? ' saindo' : ''}`}
          onAnimationEnd={aoFimDaAnimacao}
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
                <Rotulo parado="Sair de tudo" agindo="Saindo…" ativo={pendente} />
              </button>
            </form>

            <button type="button" className="auth-link" onClick={fechar} disabled={pendente}>
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="auth-link" onClick={abrir}>
          Sair de todos os dispositivos
        </button>
      )}
    </div>
  );
}
