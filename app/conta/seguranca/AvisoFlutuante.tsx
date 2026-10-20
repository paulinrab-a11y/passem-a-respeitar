'use client';

import { useEffect } from 'react';
import { useDesmonteAnimado } from '@/app/_ui/desmonte-animado';
import { useSaidaAutomatica } from '@/app/_ui/saida-automatica';

type Recado = { tom: 'ok' | 'erro'; texto: string };

/**
 * O aviso no pe da tela de "Criar senha" (#389), o mesmo de "Trocar senha":
 * entra quando a acao responde, sai sozinho (#136), para enquanto o ponteiro
 * ou o foco estao nele. Fixo, fora do fluxo: nada da pagina se move quando
 * ele entra.
 *
 * Reaparece com a mesma frase duas vezes seguidas porque cada resposta traz
 * um objeto novo, e e a identidade dele que dispara a entrada.
 */
export default function AvisoFlutuante({ recado, id }: { recado: Recado | null; id: string }) {
  const { montado, saindo, abrir, fechar, aoFimDaAnimacao } = useDesmonteAnimado(400);

  useEffect(() => {
    if (recado) abrir();
  }, [recado, abrir]);

  const { pausar, retomar } = useSaidaAutomatica(recado, montado, fechar);

  if (!montado || !recado) return null;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: o papel existe (alert ou status), mas e uma expressao e o lint so le papel literal. Os eventos nao sao interacao: ponteiro e foco so param o relogio da saida.
    <div
      className={`toast ${recado.tom}${saindo ? ' saindo' : ''}`}
      onAnimationEnd={aoFimDaAnimacao}
      onMouseEnter={pausar}
      onMouseLeave={retomar}
      onFocus={pausar}
      onBlur={retomar}
      id={id}
      // Erro interrompe; sucesso espera a vez (#51).
      role={recado.tom === 'erro' ? 'alert' : 'status'}
    >
      <p>{recado.texto}</p>
      <button type="button" onClick={fechar} aria-label="Fechar aviso">
        ×
      </button>
    </div>
  );
}
