/**
 * O clique vai trocar de pagina? (Issue #50)
 *
 * Funcao pura, separada do componente para ser testada sem navegador. A
 * resposta e "sim" so quando o navegador vai mesmo carregar outro documento
 * deste site, na mesma aba.
 */

type Clique = Pick<
  MouseEvent,
  'button' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'defaultPrevented' | 'target'
>;

type Onde = Pick<Location, 'origin' | 'pathname' | 'search'>;

export function ehNavegacao(clique: Clique, onde: Onde): boolean {
  // Cancelado por outro handler: a loja abre um modal em vez de navegar.
  if (clique.defaultPrevented) return false;
  // Botao do meio e modificadores abrem outra aba; esta pagina fica.
  if (clique.button !== 0) return false;
  if (clique.metaKey || clique.ctrlKey || clique.shiftKey || clique.altKey) return false;

  const alvo = clique.target;
  if (!(alvo instanceof Element)) return false;

  const link = alvo.closest('a[href]');
  if (!(link instanceof HTMLAnchorElement)) return false;

  if (link.target && link.target !== '_self') return false;
  if (link.hasAttribute('download')) return false;

  let destino: URL;
  try {
    destino = new URL(link.href, onde.origin);
  } catch {
    return false;
  }

  // Outro site, `mailto:`, `tel:`: a barra e da troca de pagina DESTE site.
  if (destino.origin !== onde.origin) return false;

  // So a ancora mudou: rola a pagina, nao carrega nada.
  return destino.pathname !== onde.pathname || destino.search !== onde.search;
}
