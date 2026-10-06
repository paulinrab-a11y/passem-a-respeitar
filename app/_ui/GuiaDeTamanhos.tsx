'use client';

import { type MouseEvent, useEffect, useRef } from 'react';
import type { LinhaDoGuia } from '@/lib/loja/guia-de-tamanhos';

/**
 * O guia de tamanhos (Issue #206): um link e um modal com a tabela.
 *
 * E um `<dialog>` nativo, aberto com `showModal()`. O navegador cuida do que
 * um modal precisa e que da trabalho fazer a mao: foco preso dentro, fundo
 * inerte, Esc para fechar, e o foco de volta a quem abriu quando fecha.
 *
 * A saida e animada como a dos modais da home (#49): a classe `saindo` roda
 * a animacao, e o `close()` so acontece quando ela termina. Sem isso o
 * `<dialog>` some no mesmo quadro.
 *
 * Esc, dentro do modal, nao pode subir: na loja da home, a tecla tambem
 * fecha a loja, e a pessoa fecharia duas coisas com um toque.
 */
export default function GuiaDeTamanhos({
  linhas,
  produto,
}: {
  linhas: LinhaDoGuia[];
  produto: string;
}) {
  const dialogo = useRef<HTMLDialogElement>(null);
  const prazo = useRef(0);

  function abre() {
    const el = dialogo.current;
    if (!el || el.open) return;
    el.classList.remove('saindo');
    el.showModal();
  }

  function fecha() {
    const el = dialogo.current;
    if (!el?.open || el.classList.contains('saindo')) return;
    el.classList.add('saindo');
    // O `animationend` fecha; o prazo e a rede de seguranca para animacao
    // que nao roda (movimento reduzido, aba em segundo plano).
    prazo.current = window.setTimeout(termina, 300);
  }

  function termina() {
    const el = dialogo.current;
    window.clearTimeout(prazo.current);
    if (!el?.classList.contains('saindo')) return;
    el.classList.remove('saindo');
    el.close();
  }

  useEffect(() => () => window.clearTimeout(prazo.current), []);

  // Clique no fundo, fora da caixa: o alvo e o proprio `<dialog>`, porque o
  // backdrop e dele e nao de um filho.
  function aoClicar(e: MouseEvent<HTMLDialogElement>) {
    if (e.target === e.currentTarget) fecha();
  }

  return (
    <>
      <button type="button" className="guia-abrir" onClick={abre}>
        Guia de tamanhos
      </button>

      <dialog
        ref={dialogo}
        className="guia"
        aria-labelledby="guia-titulo"
        onClick={aoClicar}
        onCancel={(e) => {
          e.preventDefault();
          fecha();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') e.stopPropagation();
        }}
        onAnimationEnd={(e) => {
          if (e.target === e.currentTarget) termina();
        }}
      >
        <div className="guia-caixa">
          <button type="button" className="fechar" onClick={fecha}>
            fechar
          </button>
          <h2 id="guia-titulo">Guia de tamanhos</h2>
          <p className="guia-sub">{produto}. Medidas da peça, em centímetros.</p>

          <table className="guia-tabela">
            <thead>
              <tr>
                <th scope="col">Tamanho</th>
                <th scope="col">Altura</th>
                <th scope="col">Largura</th>
                <th scope="col">Manga</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => (
                <tr key={l.tamanho}>
                  <th scope="row">{l.tamanho}</th>
                  <td>{l.altura}</td>
                  <td>{l.largura}</td>
                  <td>{l.manga}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <ul className="guia-como">
            <li>
              <strong>Altura:</strong> da costura do ombro até a barra.
            </li>
            <li>
              <strong>Largura:</strong> de uma axila à outra, com a peça esticada.
            </li>
            <li>
              <strong>Manga:</strong> da costura do ombro até a ponta.
            </li>
          </ul>
          <p className="guia-nota">
            Compare com uma camiseta sua que vista bem. A modelagem é oversized, mais larga que o
            normal. As medidas podem variar 1 a 2 cm.
          </p>
        </div>
      </dialog>
    </>
  );
}
