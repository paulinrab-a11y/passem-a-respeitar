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
 *
 * Idempotente de proposito: a timeline da intro pode terminar depois de o
 * HomeRuntime ja ter fechado a abertura, e fechar de novo nao pode desfazer
 * nada.
 */

/** A classe que tranca a rolagem. Mesmo contrato de lib/ancora.ts e do CSS. */
const TRAVA = 'locked';

export function fechaAbertura(doc: Document): void {
  const intro = doc.getElementById('intro');
  if (intro) {
    intro.classList.add('out');
    intro.style.display = 'none';
  }
  doc.documentElement.classList.remove(TRAVA);
  doc.getElementById('bar')?.classList.add('on');
}
