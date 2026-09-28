'use client';

import { type AnimationEvent, useCallback, useEffect, useRef, useState } from 'react';

/**
 * Trocar o que esta na tela deixando o que sai, sair (Issue #155).
 *
 * O React troca conteudo no mesmo quadro: o que era deixa de existir e o que
 * vem entra. Para o que vem ha animacao de entrada; para o que era, nada — ele
 * nao esta mais la para animar. Este hook segura o conteudo antigo na tela o
 * tempo de uma saida, e so entao entrega o novo.
 *
 *   alvo      o que DEVERIA estar na tela agora
 *   mostrado  o que ESTA, e continua ate a saida acabar
 *   saindo    a classe de saida esta valendo
 *
 * Um de cada vez, no mesmo lugar: o novo so entra depois que o antigo saiu.
 * Os dois juntos dobrariam a altura do bloco por um instante, e o que esta
 * embaixo pularia.
 *
 * Como no `useDesmonteAnimado`, o fim tem duas causas: o `animationend`,
 * quando vem, e um prazo, sempre. `animationend` nao e garantido, e sem o
 * prazo uma mensagem velha ficaria presa na tela.
 */
export function useTrocaComSaida<T>(
  alvo: T,
  {
    igual = Object.is,
    vazio = (valor: T) => valor == null,
    limiteMs = 250,
  }: {
    /** Dois valores que sao o mesmo conteudo. */
    igual?: (a: T, b: T) => boolean;
    /** Valor que nao desenha nada: nao ha o que esperar sair. */
    vazio?: (valor: T) => boolean;
    limiteMs?: number;
  } = {}
) {
  const [mostrado, setMostrado] = useState(alvo);
  const [saindo, setSaindo] = useState(false);
  const ultimo = useRef(alvo);
  const prazo = useRef<ReturnType<typeof setTimeout> | null>(null);

  const limpa = useCallback(() => {
    if (prazo.current) clearTimeout(prazo.current);
    prazo.current = null;
  }, []);

  const termina = useCallback(() => {
    limpa();
    setSaindo(false);
    // O alvo mais recente, e nao o do instante em que a saida comecou: se
    // mudou de novo no meio, e o ultimo que interessa.
    setMostrado(ultimo.current);
  }, [limpa]);

  const mesmo = igual(mostrado, alvo);
  const nadaNaTela = vazio(mostrado);

  useEffect(() => {
    ultimo.current = alvo;

    if (mesmo) {
      // O alvo voltou a ser o que esta na tela: a saida perdeu o sentido.
      if (prazo.current) {
        limpa();
        setSaindo(false);
      }
      return;
    }

    if (nadaNaTela) {
      setMostrado(alvo);
      return;
    }

    // Ja saindo: o prazo em curso vale, e `termina` le o alvo mais recente.
    if (prazo.current) return;

    setSaindo(true);
    prazo.current = setTimeout(termina, limiteMs);
  }, [alvo, mesmo, nadaNaTela, limiteMs, limpa, termina]);

  // Desmontar com o prazo correndo deixaria um timer chamando setState em
  // algo que nao existe mais.
  useEffect(() => limpa, [limpa]);

  const aoFimDaAnimacao = useCallback(
    (evento: AnimationEvent) => {
      // `animationend` sobe pela arvore. O fim da animacao de um filho — o
      // preenchimento de um botao, por exemplo — nao e o fim da saida.
      if (evento.target !== evento.currentTarget) return;
      if (saindo) termina();
    },
    [saindo, termina]
  );

  return { mostrado, saindo, aoFimDaAnimacao };
}
