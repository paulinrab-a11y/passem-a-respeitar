'use client';

import { useRouter } from 'next/navigation';
import { useOptimistic, useTransition } from 'react';
import { urlDoCheckout } from '@/lib/loja/url-do-checkout';

/**
 * Tamanho e quantidade no proprio checkout (Issue #356).
 *
 * Antes, "Trocar o tamanho" levava de volta a /#merch: quem ja tinha digitado
 * o endereco perdia tudo e escolhia de novo na home. Aqui a troca muda so a
 * URL (`?tam=`, `?q=`), por navegacao suave: o servidor refaz o orcamento com
 * o catalogo — o preco continua vindo de la, nunca daqui —, e o formulario de
 * entrega, que esta no mesmo lugar da arvore, fica com o que a pessoa
 * digitou. No App Router, trocar so a busca da URL nao recria a pagina.
 *
 * A URL continua sendo a fonte da escolha: o link compartilhado, o voltar do
 * navegador e o login no meio (`next=/checkout?...`) funcionam como antes.
 *
 * Radios de verdade, e nao botoes com `aria-pressed`: e um "escolha um", o
 * leitor de tela anuncia "2 de 3" e as setas andam entre as opcoes.
 */

type Escolhido = { tamanho: string | null; quantidade: number };

export default function Escolha({
  slug,
  tamanhos,
  tamanho,
  quantidade,
  maximo,
}: {
  slug: string;
  tamanhos: string[];
  tamanho: string | null;
  quantidade: number;
  maximo: number;
}) {
  const router = useRouter();
  const [trocando, comecar] = useTransition();
  // A marcacao anda na hora do clique; quando o servidor responde, a da URL
  // assume. Controlado, e nao `defaultChecked`: o voltar do navegador muda a
  // URL sem clique, e o radio precisa acompanhar.
  const [marcado, marca] = useOptimistic<Escolhido, Partial<Escolhido>>(
    { tamanho, quantidade },
    (atual, novo) => ({ ...atual, ...novo })
  );

  function troca(novo: Partial<Escolhido>) {
    const proximo = { tamanho, quantidade, ...novo };
    comecar(() => {
      marca(novo);
      // `replace`, e nao `push`: trocar de M para G cinco vezes nao pode
      // virar cinco voltas no botao de voltar. `scroll: false`: a pessoa esta
      // no resumo, e a pagina nao pula para o topo.
      router.replace(urlDoCheckout(slug, proximo.tamanho, proximo.quantidade), { scroll: false });
    });
  }

  const quantidades = Array.from({ length: maximo }, (_, i) => i + 1);

  return (
    <div className="checkout-escolha" aria-busy={trocando || undefined}>
      {tamanhos.length > 0 && tamanho ? (
        <fieldset>
          <legend>Tamanho</legend>
          <div className="checkout-opcoes">
            {tamanhos.map((t) => (
              <label key={t} className="checkout-opcao">
                <input
                  type="radio"
                  name="escolha-tamanho"
                  value={t}
                  checked={t === marcado.tamanho}
                  onChange={() => troca({ tamanho: t })}
                />
                <span>{t}</span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      <fieldset>
        <legend>Quantidade</legend>
        <div className="checkout-opcoes">
          {quantidades.map((n) => (
            <label key={n} className="checkout-opcao">
              <input
                type="radio"
                name="escolha-quantidade"
                value={n}
                checked={n === marcado.quantidade}
                onChange={() => troca({ quantidade: n })}
              />
              <span>{n}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {/* Quem ouve a pagina precisa saber que o resumo e o frete vao mudar. */}
      <p className="sr" role="status">
        {trocando && 'Atualizando o pedido…'}
      </p>
    </div>
  );
}
