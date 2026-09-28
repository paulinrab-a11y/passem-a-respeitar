'use client';

import { useEffect, useState } from 'react';
import { useTrocaComSaida } from '@/app/_ui/troca-com-saida';
import type { Tom } from '@/lib/conta/pedidos';

/**
 * O selo de status de um pedido, na tela administrativa (Issue #157).
 *
 * Quem administra muda o status de varios pedidos em sequencia. O selo trocava
 * de texto no mesmo quadro, e no meio de cinquenta cards iguais nao dava para
 * ver QUAL tinha acabado de mudar. Aqui o selo antigo sai com fade e o novo
 * entra: a mudanca acontece num lugar que o olho consegue achar.
 *
 * Na carga da pagina nao ha animacao nenhuma. O selo so ganha entrada depois
 * de uma troca — cinquenta selos piscando juntos nao sinalizam nada.
 */

type Rotulado = { rotulo: string; tom: Tom };

const mesmoSelo = (a: Rotulado, b: Rotulado) => a.rotulo === b.rotulo && a.tom === b.tom;

export default function Selo({ rotulo, tom }: Rotulado) {
  const { mostrado, saindo, aoFimDaAnimacao } = useTrocaComSaida<Rotulado>(
    { rotulo, tom },
    {
      igual: mesmoSelo,
      // Sempre ha um selo na tela: o antigo sai antes de o novo entrar.
      vazio: () => false,
      limiteMs: 200,
    }
  );

  const [trocou, setTrocou] = useState(false);
  useEffect(() => {
    if (saindo) setTrocou(true);
  }, [saindo]);

  const classes = ['pedido-status', mostrado.tom];
  if (saindo) classes.push('saindo');
  else if (trocou) classes.push('trocou');

  return (
    // A `key` e o que faz o selo novo ser um elemento novo, com a entrada dele.
    <span key={mostrado.rotulo} className={classes.join(' ')} onAnimationEnd={aoFimDaAnimacao}>
      {mostrado.rotulo}
    </span>
  );
}
