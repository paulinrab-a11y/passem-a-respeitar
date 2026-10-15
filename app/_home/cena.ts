/**
 * A cena 3D da home com "reduzir movimento" (#286).
 *
 * Saiu do legacy-site.js para o teste poder medir, como o teclado (#280) e a
 * abertura (#238). O script legado nao roda no jsdom (depende do three); o
 * que ele faz a cada quadro com o tempo e com o mouse passa por aqui.
 */

/**
 * O relogio das derivas. Tudo que a cena faz sozinha e funcao do tempo: o
 * giro lento da corrente, o pulso da luz vermelha, o balanco dos PNGs
 * cromados e das frases, o tremor das particulas. Com movimento reduzido o
 * relogio para em zero, cada termo vira uma constante e a pose que fica e a
 * de t = 0. A corrente continua andando com a rolagem, que e a pessoa quem
 * faz.
 */
export function relogio(t: number, reduz: boolean): number {
  return reduz ? 0 : t;
}

/**
 * Paralaxe do mouse. Tambem e movimento que a pessoa nao pediu: a camera e a
 * corrente seguiam o ponteiro pela pagina inteira, a cada pixel.
 */
export function paralaxe(m: number, reduz: boolean): number {
  return reduz ? 0 : m;
}

/** Giro da corrente: deriva lenta, rolagem e mouse. Com movimento reduzido, so a rolagem. */
export function giroDaCorrente(t: number, p: number, mx: number, reduz: boolean): number {
  return relogio(t, reduz) * 0.12 + p * 1.2 + paralaxe(mx, reduz) * 0.35;
}

/** A luz vermelha: pulso no tempo e o acender do fim. Com movimento reduzido, so o fim. */
export function pulsoDaLuz(t: number, fim: number, reduz: boolean): number {
  return 1.5 + Math.sin(relogio(t, reduz) * 1.7) * 0.35 + fim * 1.5;
}

/**
 * Diz se o quadro precisa ir para a GPU.
 *
 * Com movimento reduzido, cena parada nao e redesenhada: e a GPU (e a bateria)
 * de graca, e e o que deixa a vitrine em GPU por software responder. So que
 * "parada" nao e "o estado nao mudou neste quadro": a camera e as opacidades
 * chegam ao alvo por lerp, e o passo de cada quadro fica abaixo de qualquer
 * tolerancia muito antes de o caminho acabar. Por isso a comparacao e com o
 * ultimo quadro DESENHADO, e nao com o anterior: o que anda devagar acumula
 * ate passar da tolerancia e sai num quadro novo.
 *
 * `invalida` e para o que muda a imagem sem passar pelo estado: canvas
 * redimensionado (o `setSize` apaga o desenho), modelo ou textura que chegou.
 *
 * A tolerancia padrao, 0,0001, fica abaixo de um pixel tanto em posicao (na
 * distancia da camera da home) quanto em angulo: o que ela deixa de desenhar
 * nao aparece na tela.
 */
export function vigiaDeQuadro(tolerancia = 1e-4) {
  const desenhado: number[] = [];
  let sujo = true;
  return {
    invalida(): void {
      sujo = true;
    },
    /** `true` quando o estado andou desde o ultimo quadro desenhado; e conta este como desenhado. */
    precisaDesenhar(estado: readonly number[]): boolean {
      let mudou = sujo || estado.length !== desenhado.length;
      for (let i = 0; !mudou && i < estado.length; i++) {
        // Escrito pelo avesso de proposito: NaN nao e "dentro da tolerancia".
        if (!(Math.abs(estado[i] - desenhado[i]) <= tolerancia)) mudou = true;
      }
      if (!mudou) return false;
      desenhado.length = 0;
      desenhado.push(...estado);
      sujo = false;
      return true;
    },
  };
}
