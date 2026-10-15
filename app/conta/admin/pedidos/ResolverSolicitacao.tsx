'use client';

import { useActionState, useEffect, useState } from 'react';
import Mensagem from '@/app/_ui/Mensagem';
import { resolverSolicitacao } from './acoes';
import { resolverInicial } from './estado';

/**
 * "Marcar como resolvida" numa solicitacao de pos-venda (#379). Botao com
 * carregando (#50) e recado; quando da certo, a pagina e revalidada e a
 * solicitacao volta como encerrada, sem este botao.
 */
export default function ResolverSolicitacao({
  pedido,
  solicitacao,
  protocolo,
}: {
  pedido: string;
  solicitacao: string;
  protocolo: string;
}) {
  const [estado, acao, pendente] = useActionState(resolverSolicitacao, resolverInicial);
  const [respostas, setRespostas] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: so a troca de estado importa
  useEffect(() => {
    setRespostas((n) => n + 1);
  }, [estado]);

  return (
    <form action={acao} className="admin-resolver">
      <input type="hidden" name="pedido" value={pedido} />
      <input type="hidden" name="solicitacao" value={solicitacao} />
      <button
        type="submit"
        className={`btn${pendente ? ' carregando' : ''}`}
        disabled={pendente}
        // O protocolo no nome: pode haver mais de uma aberta no mesmo pedido.
        aria-label={`Marcar ${protocolo} como resolvida`}
      >
        Marcar como resolvida
      </button>
      <Mensagem
        texto={estado.recado?.texto}
        chave={respostas}
        classe={`conta-recado ${estado.recado?.tom ?? 'erro'}`}
        papel="alert"
      />
    </form>
  );
}
