import { prendeFundo, soltaFundo } from '@/app/_ui/fundo-inerte';

/**
 * Os modais da home, a loja e a sala, com saida animada (#49).
 *
 * `fecha` so poe a classe `saindo`; quem tira o `on` e o fim da animacao. O
 * prazo e rede de seguranca: aba em segundo plano nao dispara `animationend`,
 * e modal que nao fecha e pior que modal que fecha sem animar.
 *
 * O foco volta para quem abriu — sem isso, quem navega por teclado fecha o
 * modal e cai no topo da pagina.
 *
 * Aberto, o resto da pagina e inerte (#270): `aria-modal` so avisa o leitor de
 * tela, e o Tab saia do modal para a barra e o conteudo escondidos atras. O
 * fundo so volta no fim da saida, antes do foco — elemento inerte nao recebe
 * foco.
 *
 * Um por vez. A sala abre quando o /api/convite responde, e nesse meio tempo
 * a pessoa pode ter aberto a loja. Com as duas na tela, a loja (z-index 70)
 * cobria a sala (65) e ficava inerte por ela: nada na tela respondia e, no
 * celular, sem Esc, so recarregando. Quem abre fecha o outro, com a mesma
 * saida animada.
 *
 * Saiu do legacy-site.js para o jsdom poder abrir um sobre o outro, como a
 * abertura saiu na #238.
 */

type Modal = { abre(quem?: Element | null): void; fecha(): void };

/** O modal da home na tela, ou saindo dela. */
let naTela: Modal | null = null;

export function modalAnimado(el: HTMLElement, aoTerminar?: () => void): Modal {
  const doc = el.ownerDocument;
  let quemAbriu: HTMLElement | null = null;
  let prazo: ReturnType<typeof setTimeout> | undefined;

  const termina = () => {
    clearTimeout(prazo);
    if (!el.classList.contains('saindo')) return;
    // Lido antes de esconder: fora da tela, o navegador tira o foco de dentro
    // dele. Foco em outro modal — o que abriu e fechou este — fica onde esta.
    const foco = doc.activeElement;
    const devolve = !foco || foco === doc.body || el.contains(foco);
    el.classList.remove('on', 'saindo');
    if (naTela === modal) naTela = null;
    soltaFundo(doc, el.id);
    aoTerminar?.();
    if (devolve && quemAbriu && doc.contains(quemAbriu)) quemAbriu.focus({ preventScroll: true });
    quemAbriu = null;
  };
  el.addEventListener('animationend', (e) => {
    if (e.target === el) termina();
  });

  const modal: Modal = {
    abre(quem) {
      if (naTela && naTela !== modal) naTela.fecha();
      naTela = modal;
      clearTimeout(prazo);
      const quemFoi = quem || doc.activeElement;
      quemAbriu = quemFoi instanceof HTMLElement ? quemFoi : null;
      el.classList.remove('saindo');
      el.classList.add('on');
      prendeFundo(el, el.id);
    },
    fecha() {
      if (!el.classList.contains('on') || el.classList.contains('saindo')) return;
      el.classList.add('saindo');
      prazo = setTimeout(termina, 400);
    },
  };
  return modal;
}
