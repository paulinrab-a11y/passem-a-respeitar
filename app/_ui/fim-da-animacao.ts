import { act } from '@testing-library/react';

/**
 * Avisa o React de que a animacao de `el` acabou. So para teste.
 *
 * `fireEvent.animationEnd` nao serve aqui: ele dispara `animationend`, e o
 * React, rodando em jsdom, escuta `webkitAnimationEnd`. O React escolhe o nome
 * do evento olhando o que o navegador sabe estilizar, e o jsdom conhece
 * `WebkitAnimation` mas nao `animation`. Medido: com `animationend` o
 * `onAnimationEnd` nao e chamado; com o nome prefixado, e.
 *
 * Os dois nomes sao disparados para o teste nao quebrar no dia em que o jsdom
 * aprender a propriedade sem prefixo.
 */
export function fimDaAnimacao(el: Element) {
  act(() => {
    el.dispatchEvent(new Event('webkitAnimationEnd', { bubbles: true }));
    el.dispatchEvent(new Event('animationend', { bubbles: true }));
  });
}
