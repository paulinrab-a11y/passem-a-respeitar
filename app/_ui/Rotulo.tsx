import type { ReactNode } from 'react';

/**
 * Rotulo de botao que nao muda de largura (Issue #50).
 *
 * "Salvar" vira "Salvando…" e o botao cresce; o que esta ao lado dele anda.
 * Aqui os dois textos ocupam a MESMA celula de uma grade, um por cima do
 * outro, e so um e visivel. A largura do botao e a do maior, desde o primeiro
 * quadro, e nao muda quando a acao comeca.
 *
 * O texto escondido sai tambem da arvore de acessibilidade: o nome do botao e
 * sempre o que esta na tela.
 */
export default function Rotulo({
  parado,
  agindo,
  ativo,
}: {
  parado: ReactNode;
  agindo: ReactNode;
  ativo: boolean;
}) {
  return (
    <span className="rotulo" data-ativo={ativo ? '' : undefined}>
      <span aria-hidden={ativo ? true : undefined}>{parado}</span>
      <span aria-hidden={ativo ? undefined : true}>{agindo}</span>
    </span>
  );
}
