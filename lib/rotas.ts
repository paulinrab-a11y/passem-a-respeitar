/**
 * Classificacao de rota e validacao do destino pos-login.
 *
 * Funcoes puras, sem Next e sem Supabase, para poderem ser testadas sozinhas.
 * Quem as usa e o middleware.
 */

export const ENTRAR = '/entrar';
export const CONTA = '/conta';
const CHECKOUT = '/checkout';

/**
 * Rotas que exigem sessao.
 *
 * O checkout entra aqui (#106) e isso tem consequencia boa de graca: quem
 * clica em Comprar deslogado cai no login com `next=/checkout?...`, e
 * `destinoSeguro` devolve para o checkout com o tamanho que a pessoa tinha
 * escolhido. Sem isso, voltar para a home e refazer a escolha.
 */
export function exigeSessao(pathname: string) {
  return (
    pathname === CONTA ||
    pathname.startsWith(`${CONTA}/`) ||
    pathname === CHECKOUT ||
    pathname.startsWith(`${CHECKOUT}/`)
  );
}

/**
 * A tela que monta o Payment Brick (#108).
 *
 * E a unica rota do site que abre host externo na CSP. Por isso a pergunta
 * existe aqui, pura e testavel, em vez de virar um `startsWith` solto dentro do
 * middleware: abrir host para o site inteiro seria abrir para a home, que nao
 * precisa de nada disso.
 */
export function ehPagamento(pathname: string) {
  return pathname.startsWith(`${CHECKOUT}/pagamento/`);
}

/**
 * Paginas de autenticacao. Quem ja esta logado nao tem o que fazer nelas e e
 * mandado para a conta.
 */
export function ehRotaDeAuth(pathname: string) {
  return (
    pathname === ENTRAR || pathname === '/criar-conta' || pathname === '/recuperar-senha'
    // /redefinir-senha NAO esta aqui de proposito (#32): quem chega la tem
    // sessao — a de recuperacao, criada pelo link do e-mail. Se estivesse,
    // o middleware mandaria a pessoa para /conta antes de ela trocar a senha.
  );
}

/**
 * Rotas em que vale pagar uma ida ao Supabase para conferir a sessao.
 *
 * Nao e toda rota de proposito. O padrao que a documentacao do Supabase mostra
 * renova a sessao em TODO request, e isso poria uma chamada de rede na home —
 * que hoje responde em dezenas de milissegundos e e a pagina que quase todo
 * mundo ve. Quem so olha a home nao tem o token renovado, e nao precisa: ele e
 * renovado no instante em que a pessoa entra em qualquer rota de conta.
 */
export function precisaDeSessao(pathname: string) {
  return exigeSessao(pathname) || ehRotaDeAuth(pathname);
}

/**
 * Para onde mandar a pessoa depois do login.
 *
 * O `next` chega pela URL, entao chega de fora, entao e afirmacao e nao fato.
 * Um `next` aceito sem critica vira open redirect: o atacante manda
 * `/entrar?next=https://site-que-imita.com`, a vitima faz login no site certo
 * e e cuspida no site falso ja confiando no que ve.
 *
 * A defesa aqui e lista de permissao, nao lista de proibicao: o unico destino
 * aceito e uma rota de conta deste site. Nao tento enumerar as formas de
 * escrever um endereco externo — `//host`, `/\host`, `https://host`,
 * `/%09/host` — porque essa lista nunca termina e basta esquecer uma.
 */
export function destinoSeguro(bruto: string | null | undefined) {
  if (!bruto?.startsWith('/')) return CONTA;

  // Barra dupla e contrabarra viram endereco de outro host no navegador.
  if (bruto.startsWith('//') || bruto.includes('\\')) return CONTA;

  // Caractere de controle serve para enganar parser, nunca para navegar.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: e exatamente o que se quer detectar
  if (/[\u0000-\u001f\u007f]/.test(bruto)) return CONTA;

  const caminho = bruto.split(/[?#]/)[0];
  return exigeSessao(caminho) ? bruto : CONTA;
}

/**
 * O host principal da producao, quando o request chegou por outro (#141).
 *
 * A Vercel publica a producao em mais de um endereco: o principal, um alias
 * com o nome do time e um por deploy. Responder em todos parece inofensivo e
 * nao e: cookie de sessao vale por host, e o link de e-mail volta sempre para
 * um host so. Quem entrou pelo alias clicava no link e chegava sem sessao.
 *
 * Devolve o host para onde mandar, ou null para deixar passar. Deixa passar
 * sempre que houver duvida: fora de producao, sem a variavel, ou com um valor
 * que nao tem cara de host. Redirecionar errado derruba o site; nao
 * redirecionar so mantem o que ja era.
 */
export function hostPrincipal(
  ambiente: string | undefined,
  principal: string | undefined,
  atual: string
) {
  if (ambiente !== 'production') return null;

  const alvo = (principal ?? '').trim().toLowerCase();
  // Host puro: sem protocolo, sem caminho, sem porta. E o formato em que a
  // Vercel entrega VERCEL_PROJECT_PRODUCTION_URL.
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(alvo)) return null;

  return atual.toLowerCase() === alvo ? null : alvo;
}
