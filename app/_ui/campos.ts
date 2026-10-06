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

  /**
   * Preenche varios campos de uma vez, sem mexer nos outros. E o que a busca
   * pelo CEP faz com rua, bairro, cidade e UF (#204).
   */
  const preencher = useCallback((parcial: Partial<Record<Nome, string>>) => {
    setValores((atual) => ({ ...atual, ...parcial }));
  }, []);

  return { valores, campo, limpar, preencher };
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

/**
 * O que um campo com erro precisa dizer a quem nao ve a borda vermelha (#51).
 *
 * `aria-invalid` sozinho diz "esta errado" e nao diz por que. A ligacao com a
 * mensagem (`aria-describedby`) e o que faz o leitor de tela ler o erro quando
 * a pessoa volta ao campo.
 *
 * A ligacao so existe enquanto ha erro: apontar para um id que nao esta na
 * pagina e referencia quebrada. `outras` sao descricoes que o campo ja tinha,
 * como o medidor de senha, e continuam valendo.
 */
export function comErro(errou: boolean, idDoErro: string, outras?: string) {
  const descricoes = [outras, errou ? idDoErro : undefined].filter(Boolean).join(' ');

  return {
    'aria-invalid': errou ? (true as const) : undefined,
    'aria-describedby': descricoes || undefined,
  };
}
