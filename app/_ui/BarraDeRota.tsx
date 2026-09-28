'use client';

import { useEffect, useState } from 'react';
import { ehNavegacao } from './barra-de-rota';

/**
 * Barra de progresso no topo durante a troca de rota (Issue #50).
 *
 * O site navega por documento inteiro, entao nao ha roteador para avisar que
 * a navegacao comecou. Quem avisa e o proprio navegador: o clique num link
 * deste site, ou o `beforeunload` de uma navegacao disparada por codigo.
 *
 * A barra nao sabe quanto falta — ninguem sabe, numa troca de documento. Ela
 * cresce rapido no comeco e devagar no fim, e nunca chega a 100%: quem
 * completa e a pagina nova, aparecendo.
 */
export default function BarraDeRota() {
  const [ativa, setAtiva] = useState(false);

  useEffect(() => {
    let prazo: ReturnType<typeof setTimeout> | undefined;

    const liga = () => {
      setAtiva(true);
      // Navegacao que nao aconteceu — download, protocolo externo, handler
      // que cancelou depois. A barra nao pode ficar na tela para sempre.
      clearTimeout(prazo);
      prazo = setTimeout(() => setAtiva(false), 10_000);
    };
    const desliga = () => {
      clearTimeout(prazo);
      setAtiva(false);
    };

    const noClique = (e: MouseEvent) => {
      // Fase de bolha, no documento: quem cancelou o clique ja cancelou.
      if (ehNavegacao(e, window.location)) liga();
    };

    // Voltar pelo historico traz a pagina do cache com a barra ligada.
    const naVolta = (e: PageTransitionEvent) => {
      if (e.persisted) desliga();
    };

    document.addEventListener('click', noClique);
    window.addEventListener('beforeunload', liga);
    window.addEventListener('pageshow', naVolta);

    return () => {
      clearTimeout(prazo);
      document.removeEventListener('click', noClique);
      window.removeEventListener('beforeunload', liga);
      window.removeEventListener('pageshow', naVolta);
    };
  }, []);

  return (
    <div
      className={`barra-rota${ativa ? ' on' : ''}`}
      role="progressbar"
      aria-label="Carregando a página"
      aria-hidden={ativa ? undefined : true}
      aria-busy={ativa}
    />
  );
}
