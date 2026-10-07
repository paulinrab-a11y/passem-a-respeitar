'use client';

import { useEffect, useRef, useState } from 'react';
import Rotulo from '@/app/_ui/Rotulo';

/**
 * Copia o endereco de entrega de um pedido (Issue #242).
 *
 * E o passo que faltava entre o painel e a etiqueta: o dono abre o Melhor
 * Envio e cola. Sem o botao, ele selecionava o texto na mao — ou, pior, abria
 * o Table Editor do Supabase e copiava a linha errada.
 *
 * Tres estados, e o botao nao muda de largura em nenhum (`Rotulo`). Copiar e
 * assincrono e quase instantaneo, mas "quase" e o que faz a pessoa clicar de
 * novo: enquanto a escrita nao volta, o botao fica desabilitado e com a barra
 * de carregando (#50). "Copiado" volta ao normal sozinho, senao vira enfeite
 * e o clique seguinte nao diz se funcionou.
 *
 * Quando a area de transferencia e negada (permissao, http), a mensagem
 * aponta para o texto logo acima, que continua selecionavel: nao ha beco.
 */

const VOLTA_MS = 2500;

type Estado = 'parado' | 'copiando' | 'copiado' | 'falhou';

export default function CopiarEndereco({ texto, pedido }: { texto: string; pedido: number }) {
  const [estado, setEstado] = useState<Estado>('parado');
  const volta = useRef<ReturnType<typeof setTimeout> | null>(null);

  // O prazo de voltar morre com o componente: o status pode mudar e o card
  // ser redesenhado antes dos 2,5 s.
  useEffect(() => () => clearTimeout(volta.current ?? undefined), []);

  async function copiar() {
    if (estado === 'copiando') return;
    setEstado('copiando');

    try {
      await navigator.clipboard.writeText(texto);
      setEstado('copiado');
      clearTimeout(volta.current ?? undefined);
      volta.current = setTimeout(() => setEstado('parado'), VOLTA_MS);
    } catch {
      setEstado('falhou');
    }
  }

  const copiando = estado === 'copiando';

  return (
    <>
      <button
        type="button"
        className={`btn${copiando ? ' carregando' : ''}`}
        disabled={copiando}
        onClick={copiar}
        // O numero do pedido entra no nome: no painel ha um botao destes por
        // card, e "Copiar endereço" nove vezes nao diz de qual pedido e.
        aria-label={`Copiar endereço do pedido ${pedido}`}
      >
        <Rotulo parado="Copiar endereço" agindo="Copiado" ativo={estado === 'copiado'} />
      </button>

      {/* Quem ouve a pagina precisa saber que copiou sem voltar o foco ao
          botao para reler o rotulo. A falha e visivel para todo mundo. */}
      <p
        className={estado === 'falhou' ? 'admin-copiar-falhou' : 'sr'}
        role="status"
        aria-live="polite"
      >
        {estado === 'copiado' ? 'Endereço copiado.' : ''}
        {estado === 'falhou' ? 'Não deu para copiar. Selecione o endereço acima.' : ''}
      </p>
    </>
  );
}
