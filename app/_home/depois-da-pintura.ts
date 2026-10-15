/**
 * Espera a pagina pintar antes do trabalho pesado (#377).
 *
 * O init da cena 3D e uma tarefa longa: compila shader, sobe textura, monta a
 * corrente. Rodando logo depois da hidratacao, ele segurava a primeira
 * pintura — FCP e LCP iam para 2,4–3,3 s no desktop, com a pagina pronta no
 * HTML desde o comeco. Aqui a ordem e: um quadro (o navegador pinta o que ja
 * tem), uma tarefa nova depois dele e, se o navegador tiver folga, um
 * momento ocioso — com teto, para a intro nao ficar esperando para sempre
 * numa pagina ocupada.
 *
 * Aba em segundo plano nao entrega quadro: ali nao ha o que pintar, e a
 * espera vai direto para a tarefa seguinte. Sem isso, a home aberta numa aba
 * de fundo nao montaria nada ate a pessoa olhar para ela.
 */
export function depoisDaPintura(janela: Window, teto = 800): Promise<void> {
  return new Promise((pronto) => {
    const ocioso = () => {
      if (typeof janela.requestIdleCallback === 'function') {
        janela.requestIdleCallback(() => pronto(), { timeout: teto });
      } else {
        janela.setTimeout(pronto, 1);
      }
    };
    const depoisDoQuadro = () => janela.setTimeout(ocioso, 0);

    if (typeof janela.requestAnimationFrame === 'function' && !janela.document.hidden) {
      janela.requestAnimationFrame(depoisDoQuadro);
    } else {
      depoisDoQuadro();
    }
  });
}
