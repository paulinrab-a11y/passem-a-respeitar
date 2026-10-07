/**
 * O navegador oferece WebGL? (#238)
 *
 * Pergunta feita DEPOIS de a cena 3D lancar, nao antes: no caminho feliz o
 * three ja criou o contexto e nao ha o que sondar. No catch, e esta resposta
 * que separa o esperado do bug. Sem contexto, a cena fica de fora e e so um
 * aviso — driver na lista negra, Tor fechado, WebView antigo. Com contexto, o
 * erro e da propria cena, ou de uma versao nova do three/gsap, e precisa
 * chegar ao Sentry: nenhum teste automatico pega regressao de animacao, e
 * antes do try/catch da cena a excecao chegava la sozinha.
 *
 * Os mesmos nomes de contexto que o three tenta, na mesma ordem. O contexto
 * de sondagem e devolvido em seguida: cada contexto vivo conta no limite do
 * navegador, e este nao vai desenhar nada.
 */
export function temWebGL(doc: Document = document): boolean {
  try {
    const canvas = doc.createElement('canvas');
    const gl =
      canvas.getContext('webgl2') ||
      canvas.getContext('webgl') ||
      canvas.getContext('experimental-webgl');
    if (!gl) return false;
    if ('getExtension' in gl) gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    // Um getContext que lanca e um navegador sem WebGL de fato (ou com a API
    // bloqueada por politica), nao um bug da cena.
    return false;
  }
}
