'use client';

import { type ChangeEvent, useCallback, useState } from 'react';

/**
 * Campos de texto controlados para formulario com server action (Issue #130).
 *
 * O React 19 reseta os campos NAO-controlados de um `<form action>` assim que
 * a acao responde — inclusive quando ela responde com erro. A pessoa erra o
 * CEP e perde rua, numero, bairro, cidade e UF. Campo controlado nao e
 * resetado: o valor mora aqui, no cliente, e o formulario so o espelha.
 *
 * Senha entra aqui tambem, e pelo mesmo caminho: o valor nasce no teclado e
 * fica no navegador. Nada volta do servidor para repopular campo — o estado
 * da acao carrega mensagem e nome do campo que errou, nunca o que foi
 * digitado.
 */
export function useCampos<Nome extends string>(iniciais: Record<Nome, string>) {
  const [valores, setValores] = useState(iniciais);

  /** Espalhar no `<input>`: `name`, `value` e `onChange` saem juntos. */
  const campo = (nome: Nome) => ({
    name: nome,
    value: valores[nome],
    onChange: (e: ChangeEvent<HTMLInputElement>) => {
      const valor = e.target.value;
      setValores((atual) => ({ ...atual, [nome]: valor }));
    },
  });

  /**
   * Esvazia os campos citados, ou todos. E o que o reset do React fazia no
   * SUCESSO e deixa de fazer com campo controlado: senha trocada nao fica
   * parada no formulario.
   */
  const limpar = useCallback((...nomes: Nome[]) => {
    setValores((atual) => {
      const alvos = nomes.length > 0 ? nomes : (Object.keys(atual) as Nome[]);
      const novo = { ...atual };
      for (const nome of alvos) novo[nome] = '';
      return novo;
    });
  }, []);

  return { valores, campo, limpar };
}

/**
 * Caixinha que sobrevive ao reset do formulario (Issue #130).
 *
 * Aqui `checked` controlado NAO resolve: o reset do React 19 chama
 * `form.reset()`, que devolve a caixinha ao padrao do DOM, e o React nao
 * reaplica o `checked` porque a prop nao mudou — estado diz marcada, tela
 * mostra desmarcada. Medido no teste, que falhava com `checked`.
 *
 * O caminho e o contrario: deixar a caixinha com o DOM e manter o PADRAO dela
 * igual ao estado. Quando o reset vier, ele devolve a caixinha para onde ela
 * ja estava.
 */
export function useCaixinha(inicial = false) {
  const [marcada, setMarcada] = useState(inicial);

  const caixinha = {
    defaultChecked: marcada,
    onChange: (e: ChangeEvent<HTMLInputElement>) => setMarcada(e.target.checked),
  };

  return { marcada, caixinha };
}
