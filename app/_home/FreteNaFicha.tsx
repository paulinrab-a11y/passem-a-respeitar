'use client';

import { useEffect, useId, useState } from 'react';
import Mensagem from '@/app/_ui/Mensagem';
import { reais } from '@/lib/conta/pedidos';
import { cepLegivel } from '@/lib/loja/endereco';
import { cotarFreteNaFicha, type FreteNaFicha as Resposta } from './acoes';
import { lembraCep, useCepLembrado } from './cep-lembrado';

/**
 * O frete na ficha da camiseta (Issue #205), antes de login e de checkout.
 *
 * Um campo de CEP e uma linha de resposta. A linha tem lugar reservado em
 * todos os estados — vazia, calculando, com preco, com erro —, entao nada da
 * ficha anda quando a cotacao chega.
 *
 * O CEP fica lembrado no navegador: a ficha da secao e a da loja mostram o
 * mesmo, e o checkout comeca com ele preenchido.
 */

type Cotacao = { cep: string; resposta: Resposta | null };

export default function FreteNaFicha({ slug, tamanho }: { slug: string; tamanho: string | null }) {
  const id = useId();
  const cep = useCepLembrado();
  const completo = cep.length === 8;
  const [cotacao, setCotacao] = useState<Cotacao>({ cep: '', resposta: null });

  useEffect(() => {
    if (!completo || cep === cotacao.cep) return;

    // Guardado antes da chamada: a resposta de um CEP velho nao toma o lugar
    // da do novo.
    setCotacao({ cep, resposta: null });
    // Sem `useTransition`: ele marcaria "pendente" enquanto QUALQUER cotacao
    // estivesse no ar, e uma resposta velha e lenta esconderia a nova. O que
    // diz se esta calculando e a resposta do CEP atual ainda nao ter chegado.
    cotarFreteNaFicha({ slug, tamanho, cep }).then((resposta) => {
      setCotacao((atual) => (atual.cep === cep ? { cep, resposta } : atual));
    });
  }, [cep, completo, cotacao.cep, slug, tamanho]);

  const atual = completo && cotacao.cep === cep ? cotacao.resposta : null;
  const calculando = completo && atual === null;

  return (
    <div className="frete-ficha">
      <label htmlFor={id}>Frete para o seu CEP</label>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="postal-code"
        maxLength={9}
        placeholder="00000-000"
        // O que se mostra e o CEP com hifen; o que se guarda sao os digitos.
        value={cep ? cepLegivel(cep) : ''}
        onChange={(e) => lembraCep(e.target.value)}
      />
      <div className="frete-ficha-resposta" aria-live="polite" aria-busy={calculando || undefined}>
        {!completo ? null : calculando ? (
          <span className="frete-ficha-calculando">Calculando…</span>
        ) : atual?.ok ? (
          <ul className="frete-ficha-opcoes">
            {atual.opcoes.map((o) => (
              <li key={o.servico}>
                <strong>{o.nome}</strong> {reais(o.precoCentavos)} · até {o.prazoDias}{' '}
                {o.prazoDias === 1 ? 'dia útil' : 'dias úteis'} depois da produção
              </li>
            ))}
          </ul>
        ) : atual ? (
          <Mensagem texto={atual.texto} chave={cep} classe="frete-ficha-erro" papel="status" />
        ) : null}
      </div>
    </div>
  );
}
