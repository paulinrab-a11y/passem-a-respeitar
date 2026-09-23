'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Montar e desmontar com animacao de saida, sem biblioteca.
 *
 * O jeito ingenuo e desmontar no `animationend`. Funciona quase sempre, e a
 * parte do "quase" e o problema: `animationend` **nao e garantido**. Ele nao
 * dispara se a animacao for interrompida, se um ancestral virar
 * `display:none`, se o navegador decidir nao animar naquele quadro. E quando
 * nao dispara, o elemento nao some nunca — nao e um piscar feio, e um menu
 * preso em cima da pagina que so sai recarregando.
 *
 * Eu peguei exatamente isso testando o menu da barra: a animacao de saida
 * ficou parada em `opacity: 1` e o evento nunca chegou.
 *
 * Entao o desmonte tem duas causas: o evento, quando vem, e um prazo, sempre.
 * O que acontecer primeiro vence.
 */
export function useDesmonteAnimado(limiteMs = 400) {
  const [montado, setMontado] = useState(false);
  const [saindo, setSaindo] = useState(false);
  const prazo = useRef<ReturnType<typeof setTimeout> | null>(null);

  const limpa = useCallback(() => {
    if (prazo.current) clearTimeout(prazo.current);
    prazo.current = null;
  }, []);

  const desmonta = useCallback(() => {
    limpa();
    setSaindo(false);
    setMontado(false);
  }, [limpa]);

  const abrir = useCallback(() => {
    limpa();
    setSaindo(false);
    setMontado(true);
  }, [limpa]);

  const fechar = useCallback(() => {
    // Fechar duas vezes nao pode reiniciar o prazo, senao um clique repetido
    // empurra o desmonte para sempre.
    if (prazo.current) return;
    setSaindo(true);
    prazo.current = setTimeout(desmonta, limiteMs);
  }, [desmonta, limiteMs]);

  // Desmontar o componente pai com o prazo correndo deixaria um timer vivo
  // chamando setState em algo que nao existe mais.
  useEffect(() => limpa, [limpa]);

  const aoFimDaAnimacao = useCallback(() => {
    if (saindo) desmonta();
  }, [saindo, desmonta]);

  return { montado, saindo, abrir, fechar, aoFimDaAnimacao };
}
