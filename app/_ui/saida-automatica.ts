'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Quanto tempo um aviso fica na tela antes de sair sozinho.
 *
 * O erro fica mais que o sucesso porque pede leitura e uma decisao, mas
 * tambem sai: um aviso fixo que so fecha no "x" fica em cima do que a pessoa
 * quer clicar em seguida (#136).
 */
export const TEMPO_NA_TELA = { ok: 6000, erro: 10000 } as const;

type Aviso = { tom: keyof typeof TEMPO_NA_TELA };

/**
 * Saida automatica de um aviso, com pausa enquanto a pessoa esta nele.
 *
 * O prazo depende da identidade de `aviso`, nao do texto: a mesma mensagem
 * duas vezes seguidas e um aviso novo e ganha o tempo inteiro de novo.
 *
 * Ponteiro em cima ou foco dentro param o relogio. Na volta ele recomeca do
 * zero em vez de continuar de onde parou — quem estava lendo nao perde o aviso
 * meio segundo depois de tirar o mouse.
 */
export function useSaidaAutomatica(aviso: Aviso | null, naTela: boolean, fechar: () => void) {
  const [pausado, setPausado] = useState(false);

  useEffect(() => {
    // Fechar no "x" desmonta o aviso com o ponteiro ainda em cima, e o
    // `mouseleave` nunca chega. Sem isto o proximo aviso ja nasceria pausado.
    if (!naTela) setPausado(false);
  }, [naTela]);

  useEffect(() => {
    if (!aviso || !naTela || pausado) return;

    const t = setTimeout(fechar, TEMPO_NA_TELA[aviso.tom]);
    return () => clearTimeout(t);
  }, [aviso, naTela, pausado, fechar]);

  const pausar = useCallback(() => setPausado(true), []);
  const retomar = useCallback(() => setPausado(false), []);

  return { pausar, retomar };
}
