/**
 * Codigo de rastreio do pedido enviado (Issue #378).
 *
 * Funcao pura, sem `server-only`: a acao do painel valida com isto, a tela do
 * cliente le a URL dos Correios daqui, e o teste confere as duas coisas sem
 * banco. A mesma regra mora numa check constraint de `orders`
 * (migration 20261015180000): a acao confere antes para dar mensagem boa, o
 * banco confere de novo porque rota se esquece.
 */

/**
 * Objeto dos Correios no padrao S10 da UPU: duas letras do servico, nove
 * digitos (o ultimo e o verificador) e a sigla do pais. Ex.: AB123456789BR.
 */
export const FORMATO_DO_RASTREIO = /^[A-Z]{2}[0-9]{9}[A-Z]{2}$/;

/** Teto do link opcional, o mesmo da constraint. */
export const URL_DE_RASTREIO_MAX = 500;

/**
 * Pagina publica de rastreamento dos Correios. Nao ha link direto para um
 * objeto: a pagina pede captcha a cada consulta (conferido em 15/10/2026), e
 * um `?objetos=` que hoje funcionasse pararia sem aviso. Por isso a tela do
 * cliente mostra o codigo com botao de copiar ao lado deste link.
 */
export const RASTREIO_DOS_CORREIOS = 'https://rastreamento.correios.com.br/app/index.php';

/**
 * Como o dono digita: com espaco no meio, minusculo, colado da etiqueta com
 * quebra de linha. Tudo isso vira a unica grafia que o banco aceita.
 */
export function normalizaRastreio(bruto: string): string {
  return bruto.replace(/\s+/g, '').toUpperCase();
}

/** O codigo, ja normalizado, tem a forma dos Correios. */
export function rastreioValido(codigo: string): boolean {
  return FORMATO_DO_RASTREIO.test(codigo);
}

/**
 * Link opcional (a pagina do Melhor Envio, por exemplo): so https e sem
 * espaco, como a constraint. Vazio e "sem link", nao erro.
 */
export function urlDeRastreioValida(url: string): boolean {
  if (url.length > URL_DE_RASTREIO_MAX || /\s/.test(url)) return false;
  try {
    return new URL(url).protocol === 'https:' && url.startsWith('https://');
  } catch {
    return false;
  }
}

/** O rastreio como a tela mostra. */
export type RastreioDoPedido = {
  codigo: string;
  /** Link que o dono gravou, quando gravou. */
  url: string | null;
};

/**
 * Nulo quando nao ha codigo, ou quando o que veio do banco nao tem a forma
 * (nao deveria acontecer — a constraint recusa —, mas a tela nao mostra um
 * codigo torto como se fosse rastreavel). URL fora do padrao some sozinha.
 */
export function leRastreio(
  codigo: string | null | undefined,
  url: string | null | undefined
): RastreioDoPedido | null {
  if (!codigo || !rastreioValido(codigo)) return null;
  return { codigo, url: url && urlDeRastreioValida(url) ? url : null };
}
