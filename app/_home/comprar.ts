import { ehNavegacao } from '@/app/_ui/barra-de-rota';

/**
 * O Comprar da loja leva ao checkout na mesma aba (#301).
 *
 * O botao herdou `target="_blank"` do placeholder de quando o destino era uma
 * loja de fora. Desde a #106 ele leva ao /checkout deste site, e a aba nova
 * deixava a home para tras com a loja aberta, a pagina travada e o audio e o
 * WebGL rodando: quem pagava, fechava a aba e voltava achava que nada tinha
 * acontecido. E troca de pagina em outra aba nao acende a barra de rota.
 *
 * Na mesma aba, a loja sai com a animacao de sempre enquanto a proxima pagina
 * carrega, debaixo da barra de rota. E o Voltar do navegador, que traz a home
 * do cache como ela estava, traz sem o modal por cima.
 *
 * Ctrl, Cmd, Shift e o botao do meio sao da pessoa: abrem outra aba ou janela,
 * e a loja continua aberta nesta. Quem decide e o `ehNavegacao` da barra de
 * rota, para a barra e a loja nunca discordarem sobre o mesmo clique.
 *
 * Saiu do legacy-site.js para o jsdom poder testar, como os modais (#270).
 */
export function ligaComprar(link: HTMLAnchorElement, fecha: () => void): void {
  link.addEventListener('click', (e) => {
    // Sem produto no catalogo o destino e `#`. Em aba nova, abria outra copia
    // da home; na mesma aba, rolaria esta para o topo, atras da loja. Sem
    // tamanho escolhido nao ha destino nenhum (#347).
    const destino = link.getAttribute('href');
    if (!destino || destino === '#') {
      e.preventDefault();
      return;
    }
    const janela = link.ownerDocument.defaultView;
    if (janela && ehNavegacao(e, janela.location)) fecha();
  });
}
