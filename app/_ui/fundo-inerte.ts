/**
 * Fundo inerte para os modais feitos a mao (#270).
 *
 * `aria-modal="true"` so avisa o leitor de tela; o navegador nao prende nada
 * por causa dele. O Tab continuava andando pela pagina atras da abertura, da
 * loja, da sala e da reautenticacao — links invisiveis, botoes que a pessoa
 * nao ve. O `<dialog>` com `showModal()` resolveria sozinho, como no guia de
 * tamanhos, mas trocaria o elemento, o empilhamento e a animacao de saida de
 * modais que ja estao no ar. Aqui o modal fica como esta, e e o resto que vira
 * `inert`: sem foco, sem clique, fora da arvore de acessibilidade.
 *
 * O resto e o que nao contem o modal: os irmaos dele e os irmaos de cada
 * ancestral ate o `<body>`. Lista fixa de seletores esqueceria o proximo
 * elemento que alguem pusesse no `<body>`.
 *
 * Quem tornou inerte fica anotado no proprio elemento. Assim `soltaFundo` nao
 * precisa de estado guardado em modulo — a abertura e fechada por dois
 * caminhos (o script da home e o HomeRuntime) — e dois modais na tela ao
 * mesmo tempo nao soltam o fundo um do outro, feche quem fechar primeiro.
 */

const DONOS = 'data-inerte-por';

/** Nao aparecem na tela nem recebem foco: nada a prender. */
const SEM_CORPO = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'TEMPLATE', 'NOSCRIPT']);

function donos(el: Element): string[] {
  return (el.getAttribute(DONOS) ?? '').split(' ').filter(Boolean);
}

/** Torna inerte tudo o que esta fora de `modal`, em nome de `dono`. */
export function prendeFundo(modal: Element, dono: string): void {
  const corpo = modal.ownerDocument.body;
  let atual: Element = modal;

  while (atual !== corpo) {
    const pai = atual.parentElement;
    if (!pai) return;

    for (const irmao of Array.from(pai.children)) {
      if (irmao === atual || SEM_CORPO.has(irmao.tagName)) continue;

      const lista = donos(irmao);
      // Inerte por outra mao, que nao anotou: nao e nosso para soltar depois.
      if (irmao.hasAttribute('inert') && lista.length === 0) continue;

      if (!lista.includes(dono)) lista.push(dono);
      irmao.setAttribute(DONOS, lista.join(' '));
      irmao.setAttribute('inert', '');
    }

    atual = pai;
  }
}

/** Devolve o que `dono` tornou inerte, menos o que outro dono ainda segura. */
export function soltaFundo(doc: Document, dono: string): void {
  for (const el of Array.from(doc.querySelectorAll(`[${DONOS}]`))) {
    const resto = donos(el).filter((d) => d !== dono);

    if (resto.length > 0) {
      el.setAttribute(DONOS, resto.join(' '));
      continue;
    }

    el.removeAttribute(DONOS);
    el.removeAttribute('inert');
  }
}
