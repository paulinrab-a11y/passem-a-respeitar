import { prendeFundo, soltaFundo } from '@/app/_ui/fundo-inerte';

/**
 * Fechar a abertura da home, no DOM (#238).
 *
 * Duas saidas chegam aqui e precisam deixar a pagina no MESMO estado: o
 * `fecha()` da intro do script legado (fim da timeline, botao pular, prazo de
 * 19 s) e o HomeRuntime, quando o script nao chega — chunk do three que nao
 * baixou, ou init que lancou antes de a intro existir. Sem esta funcao, cada
 * saida fazia a sua lista de passos, e a lista do caminho de erro era a que
 * ninguem testava.
 *
 * O estado e o que o resto do site espera: `#intro` some (a classe `out`
 * tira o pointer-events, o display tira da tela), a trava de rolagem cai —
 * `html.locked` e o contrato que `lib/ancora.ts` observa — e a barra aparece.
 * Desde a #270, o fundo deixa de ser inerte e o foco que estava na abertura
 * vai para a barra.
 *
 * Idempotente de proposito: a timeline da intro pode terminar depois de o
 * HomeRuntime ja ter fechado a abertura, e fechar de novo nao pode desfazer
 * nada.
 */

/** A classe que tranca a rolagem. Mesmo contrato de lib/ancora.ts e do CSS. */
const TRAVA = 'locked';

/** Quem segura o fundo inerte enquanto a abertura esta na tela. */
const DONO = 'abertura';

/**
 * Enquanto a abertura cobre a tela, o resto da pagina e inerte (#270).
 *
 * `#bar` vem ANTES de `#intro` no HTML: sem isto, o primeiro Tab da home caia
 * nos links da barra, ainda invisiveis, e depois na pagina atras do preto, e
 * o leitor de tela lia tudo por baixo do "dialogo Abertura". Com o fundo
 * inerte, o primeiro Tab cai em 'ligar o som' ou 'pular'.
 *
 * O foco NAO e posto em 'pular' ao entrar, como o dialogo nativo faria: foco
 * por script sem nenhuma interacao antes conta como `:focus-visible` no
 * Chrome (medido), e o contorno vermelho apareceria em volta de 'pular' para
 * todo mundo, a cada visita — a abertura mudaria de cara.
 */
export function prendeAbertura(doc: Document): void {
  const intro = doc.getElementById('intro');
  if (!intro || intro.classList.contains('out')) return;
  prendeFundo(intro, DONO);
}

export function fechaAbertura(doc: Document): void {
  const intro = doc.getElementById('intro');
  // Lido antes de esconder: com `#intro` fora da tela, o navegador tira o foco
  // de dentro dele e ja nao da para saber onde estava.
  const focoNaAbertura = Boolean(intro?.contains(doc.activeElement));

  if (intro) {
    intro.classList.add('out');
    intro.style.display = 'none';
  }
  doc.documentElement.classList.remove(TRAVA);
  doc.getElementById('bar')?.classList.add('on');

  // O fundo volta antes do foco: elemento inerte nao recebe foco.
  soltaFundo(doc, DONO);

  // Quem pulou pelo teclado continua de onde a pagina comeca, e nao no
  // <body>, de onde o proximo Tab recomecava do topo. So quando o foco estava
  // na abertura: quem nao tocou em nada nao ganha um contorno de foco que nao
  // pediu. Sem rolar, para a pagina abrir no topo como sempre abriu.
  if (focoNaAbertura) doc.getElementById('som')?.focus({ preventScroll: true });
}

/**
 * O desfoque da entrada do manifesto sem animar `filter` (#286).
 *
 * Cada linha entrava com `filter: blur(14px)` indo a zero, e o CSS deixava
 * `will-change: filter` fixo. A regra do projeto e animar so `transform` e
 * `opacity`. O desfoque agora e uma copia da linha, ja borrada e parada, que
 * some enquanto a linha nitida aparece por cima: as duas so mudam de
 * opacidade, e o olho le o mesmo foco chegando.
 *
 * A camada nitida (`.nitida`) vem do servidor, com o texto; a copia e montada
 * aqui, so para quem ve a animacao. No HTML o texto aparece uma vez, e a copia
 * nasce `aria-hidden` antes de entrar na pagina: o manifesto e `aria-live`, e
 * texto novo nele seria lido em voz alta.
 *
 * Devolve as duas camadas para a timeline, ou `null` quando a linha nao tem a
 * camada nitida. Chamar de novo devolve a mesma copia.
 */
export function nevoaDaLinha(linha: Element): { nitida: HTMLElement; nevoa: HTMLElement } | null {
  const nitida = linha.querySelector<HTMLElement>(':scope > .nitida');
  if (!nitida) return null;
  const pronta = linha.querySelector<HTMLElement>(':scope > .nevoa');
  if (pronta) return { nitida, nevoa: pronta };

  const nevoa = nitida.cloneNode(true) as HTMLElement;
  nevoa.className = 'nevoa';
  nevoa.setAttribute('aria-hidden', 'true');
  // Id copiado seria id repetido na pagina.
  for (const comId of nevoa.querySelectorAll('[id]')) comId.removeAttribute('id');
  linha.appendChild(nevoa);
  return { nitida, nevoa };
}
