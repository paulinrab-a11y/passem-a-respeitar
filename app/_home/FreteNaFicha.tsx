'use client';

import { useEffect, useId } from 'react';
import Mensagem from '@/app/_ui/Mensagem';
import { reais } from '@/lib/conta/pedidos';
import { cepLegivel } from '@/lib/loja/endereco';
import { cotarFreteNaFicha } from './acoes';
import {
  chaveDoFrete,
  largaRecusas,
  lembraCep,
  pedeFrete,
  useCepLembrado,
  useFreteDaChave,
} from './cep-lembrado';

/**
 * O frete na ficha da camiseta (Issue #205), antes de login e de checkout.
 *
 * Um campo de CEP e uma linha de resposta. A linha tem lugar reservado em
 * todos os estados — vazia, calculando, com preco, com erro —, entao nada da
 * ficha anda quando a cotacao chega.
 *
 * O CEP fica lembrado no navegador: a ficha da secao e a da loja mostram o
 * mesmo, e o checkout comeca com ele preenchido. A cotacao tambem e uma so
 * para as duas (#308).
 */

export default function FreteNaFicha({ slug, tamanho }: { slug: string; tamanho: string | null }) {
  const id = useId();
  const cep = useCepLembrado();
  const completo = cep.length === 8;
  // A cotacao e da pagina, nao desta ficha (#308): a secao e a loja leem a
  // mesma, e um CEP vira uma consulta so. A chave e a do CEP da tela, entao a
  // resposta de um CEP velho nunca aparece no lugar da do novo.
  const chave = chaveDoFrete(slug, tamanho, cep);
  const resposta = useFreteDaChave(chave);

  useEffect(() => {
    if (!completo) {
      largaRecusas();
      return;
    }
    pedeFrete(chave, () => cotarFreteNaFicha({ slug, tamanho, cep }));
  }, [chave, completo, slug, tamanho, cep]);

  const atual = completo ? resposta : null;
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
