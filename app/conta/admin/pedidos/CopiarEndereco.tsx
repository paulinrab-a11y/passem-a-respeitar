'use client';

import Copiar from '@/app/_ui/Copiar';

/**
 * Copia o endereco de entrega de um pedido (Issue #242).
 *
 * E o passo que faltava entre o painel e a etiqueta: o dono abre o Melhor
 * Envio e cola. Sem o botao, ele selecionava o texto na mao — ou, pior, abria
 * o Table Editor do Supabase e copiava a linha errada.
 *
 * Os estados do botao moram em app/_ui/Copiar.tsx (#378), que o codigo de
 * rastreio tambem usa.
 */
export default function CopiarEndereco({ texto, pedido }: { texto: string; pedido: number }) {
  return (
    <Copiar
      texto={texto}
      rotulo="Copiar endereço"
      // O numero do pedido entra no nome: no painel ha um botao destes por
      // card, e "Copiar endereço" nove vezes nao diz de qual pedido e.
      nome={`Copiar endereço do pedido ${pedido}`}
      copiado="Endereço copiado."
      falhou="Não deu para copiar. Selecione o endereço acima."
    />
  );
}
