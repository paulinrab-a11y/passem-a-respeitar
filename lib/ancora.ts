/**
 * Leva a pagina ate a ancora da URL depois que a intro solta a rolagem (#92).
 *
 * O problema: a intro da home chama `scrollTo(0, 0)` e tranca a rolagem antes
 * de o navegador poder honrar a ancora. Quem chega em `/#merch` vindo de outra
 * rota ve a URL certa e a pagina no topo, com a secao 9000px abaixo.
 *
 * A espera aqui nao e por tempo, e pelo destravamento de verdade. Quem tranca e
 * `html.locked` (ver `html.locked{overflow:hidden}` em globals.css), e as tres
 * saidas da intro — fim da timeline, botao pular e o prazo de 19s do proprio
 * script — passam todas pelo mesmo `fecha()`, que remove essa classe. Observar
 * a classe e observar o evento real; um `setTimeout` daqui seria um palpite
 * sobre a duracao de uma animacao que pode mudar.
 *
 * Generico de proposito: qualquer id valido da pagina funciona, nao so `#merch`.
 */

/** A classe que tranca a rolagem. Contrato nosso: mora no globals.css. */
const TRAVA = 'locked';

/**
 * O elemento que o hash aponta, ou null.
 *
 * `#` sozinho, hash vazio e id inexistente dao null — e null aqui significa
 * "nao ha o que fazer", nunca "rola para o topo". Quem chegou sem ancora
 * valida ja esta onde deveria estar.
 */
export function alvoDoHash(doc: Document, hash: string | null | undefined): HTMLElement | null {
  if (!hash?.startsWith('#')) return null;

  let id: string;
  try {
    id = decodeURIComponent(hash.slice(1));
  } catch {
    // `#%` e hash valido para o navegador e invalido para o decodeURIComponent.
    // Sem este catch, um endereco estranho derruba o efeito inteiro da home.
    return null;
  }

  return id ? doc.getElementById(id) : null;
}

function rolaAte(doc: Document, hash: string) {
  // Reconsultado no momento de rolar: entre a chegada e o fim da intro passam
  // alguns segundos, e o elemento e quem manda, nao a referencia guardada.
  const alvo = alvoDoHash(doc, hash);

  // `auto`, nunca `smooth`. A secao pode estar a 9000px, e animar ate la seria
  // uma viagem de segundos por um conteudo que a pessoa nao pediu para ver.
  // Como nao ha animacao nenhuma, nao ha o que desligar em
  // `prefers-reduced-motion` — o comportamento ja e o que ele pediria.
  alvo?.scrollIntoView({ block: 'start', behavior: 'auto' });
}

/**
 * Liga a espera. Devolve a funcao que desliga.
 *
 * Chamar DEPOIS do init do script da home: e nesse instante que da para saber
 * se ha intro pela frente. Com a trava posta, espera; sem ela — o `booted` do
 * legacy-site ja tinha rodado nesta aba, entao nao havera intro — rola agora.
 */
export function levaAteAAncora(janela: Window & typeof globalThis): () => void {
  const doc = janela.document;
  const raiz = doc.documentElement;

  // Lido uma vez, na chegada: e a ancora que a pessoa pediu ao abrir o
  // endereco. O que ela fizer depois e navegacao normal do navegador.
  const hash = janela.location.hash;
  if (!alvoDoHash(doc, hash)) return () => {};

  if (!raiz.classList.contains(TRAVA)) {
    rolaAte(doc, hash);
    return () => {};
  }

  const observador = new janela.MutationObserver(() => {
    if (raiz.classList.contains(TRAVA)) return;

    // Desconecta antes de rolar: a trava volta quando a Loja ou a Sala abrem,
    // e esta funcao tem um trabalho so, uma vez so.
    observador.disconnect();
    rolaAte(doc, hash);
  });

  observador.observe(raiz, { attributes: true, attributeFilter: ['class'] });

  return () => observador.disconnect();
}
