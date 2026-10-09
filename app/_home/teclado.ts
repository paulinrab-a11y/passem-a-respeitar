/**
 * A home pelo teclado (#280): os atalhos globais e o indicador "tocando".
 *
 * Saiu do legacy-site.js para o jsdom poder testar, como a abertura (#238) e
 * os modais (#270).
 */

/**
 * Onde a tecla e da pessoa, nao da home. `input` inteiro, nao so o de texto:
 * no radio e no range as setas ja mudam o valor, e girar a camiseta junto
 * seria fazer duas coisas com uma tecla.
 */
const CAMPOS = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';

/**
 * A tecla pode virar atalho da home? N pula o beat e, na loja em fotos, as
 * setas giram a camiseta. Os dois escutam a pagina inteira, e a pagina tem
 * campo de texto: o codigo do convite, o concierge, o CEP da ficha e o da
 * loja. Sem esta guarda, cada "n" digitado trocava a faixa — tres vezes numa
 * frase — e as setas do CEP giravam a camiseta em vez de mover o cursor.
 *
 * Com Ctrl, Cmd ou Alt a tecla e do navegador ou do sistema: Ctrl+N abre
 * janela, e nao pode pular o beat no caminho. Shift fica de fora: "N" tambem
 * pula, como sempre pulou.
 */
export function atalhoLivre(e: KeyboardEvent): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  const alvo = e.target;
  // Tecla na janela ou no documento, sem nada focado: nenhum campo em jogo.
  if (!(alvo instanceof Element)) return true;
  return alvo.closest(CAMPOS) === null;
}

/**
 * Acende ou apaga o indicador "tocando", que e botao (#280): Tab e Enter pulam
 * o beat como o clique e o N, que antes so existia no `title`, para quem passa
 * o mouse.
 *
 * Apagado, ele continua no lugar, so transparente — e o que deixa a entrada
 * ser so `opacity` e `transform`. Botao transparente que recebe foco e
 * armadilha: o Tab parava num lugar vazio e o leitor de tela lia um controle
 * que ninguem ve. Por isso apagado sai do Tab e da arvore de acessibilidade.
 *
 * `tabindex` e `aria-hidden`, nao `inert`: o `inert` do indicador pertence ao
 * fundo dos modais (#270), que o prende e solta por conta propria. N com a
 * loja aberta acende o indicador atras dela, e mexer no `inert` aqui o
 * soltaria por baixo do modal.
 */
export function mostraTocando(pill: HTMLElement, aceso: boolean): void {
  pill.classList.toggle('on', aceso);
  if (aceso) {
    pill.removeAttribute('tabindex');
    pill.removeAttribute('aria-hidden');
  } else {
    pill.tabIndex = -1;
    pill.setAttribute('aria-hidden', 'true');
  }
}
