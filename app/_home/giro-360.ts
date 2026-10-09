/**
 * A vitrine em fotos (#217): quatro fotos da camiseta numa tira, que giram
 * sozinhas, pelo arraste e pelas setas. E a vitrine de quem tem GPU por
 * software ou nao tem WebGL, e muito desse publico esta no celular.
 *
 * Saiu do legacy-site.js para o jsdom poder testar (#294), como o teclado
 * (#280) e a cena (#286).
 *
 * No celular ela nao respondia ao toque. O toque so chega aqui inteiro com o
 * `touch-action:pan-y` da vitrine (globals.css): sem ele o navegador toma o
 * arraste como rolagem e manda `pointercancel` uns 40 px depois, antes do
 * primeiro passo de 80 px. E o `pointerdown` parava a rotacao automatica: a
 * pessoa encostava, a camiseta congelava num angulo so e a dica sumia, sem ter
 * girado nada. Agora quem para a rotacao e o primeiro quadro trocado pela
 * pessoa — toque simples, ou arraste que virou rolagem, nao mexem nela.
 */

export interface OpcoesDoGiro {
  /** Mostra o quadro `q`, de 0 a `quadros - 1`. */
  pinta(q: number): void;
  /** "Reduzir movimento": nada gira sozinho, como a vitrine 3D desde a #286. */
  reduz: boolean;
  quadros?: number;
  /** Pixels de arraste horizontal por quadro. */
  passo?: number;
  /** Milissegundos entre os quadros da rotacao automatica. */
  intervalo?: number;
}

export interface Giro {
  /** Gira `delta` quadros pela pessoa — as setas. Para a rotacao automatica. */
  gira(delta: number): void;
  /** Liga a rotacao automatica, ou religa ao reabrir a loja depois do arraste. */
  giraSozinho(): void;
  /** Para a rotacao automatica: a loja fechou. */
  para(): void;
}

export function giro360(vit: HTMLElement, opcoes: OpcoesDoGiro): Giro {
  const { pinta, reduz, quadros = 4, passo = 80, intervalo = 1400 } = opcoes;
  let quadro = 0;
  // O `pointerId` do dedo (ou mouse) que esta girando; `null` fora do arraste.
  let dedo: number | null = null;
  let x0 = 0;
  let acumulado = 0;
  let relogio: ReturnType<typeof setInterval> | null = null;

  const mostra = (i: number) => {
    quadro = ((i % quadros) + quadros) % quadros;
    pinta(quadro);
  };
  const para = () => {
    if (relogio !== null) clearInterval(relogio);
    relogio = null;
  };
  // A pessoa girou: a rotacao automatica sai do caminho e a dica some.
  const daPessoa = (i: number) => {
    para();
    vit.classList.add('usada');
    mostra(i);
  };

  // Um dedo so. Na pinca, o segundo dedo chegava aqui ate o navegador cancelar
  // os dois para ampliar, e o giro somava o X ora de um, ora do outro: a
  // camiseta girava aos trancos e a rotacao parava. Dois dedos sao pinca, nao
  // giro, e o arraste do primeiro tambem larga. O mouse e sempre o principal.
  vit.addEventListener('pointerdown', (e) => {
    if (!e.isPrimary) {
      dedo = null;
      return;
    }
    dedo = e.pointerId;
    x0 = e.clientX;
    acumulado = 0;
    vit.setPointerCapture?.(e.pointerId);
  });
  // So o eixo X: o vertical e da rolagem do modal, que o `pan-y` deixa com o
  // navegador.
  vit.addEventListener('pointermove', (e) => {
    if (e.pointerId !== dedo) return;
    acumulado += e.clientX - x0;
    x0 = e.clientX;
    while (acumulado >= passo) {
      daPessoa(quadro - 1);
      acumulado -= passo;
    }
    while (acumulado <= -passo) {
      daPessoa(quadro + 1);
      acumulado += passo;
    }
  });
  const solta = (e: PointerEvent) => {
    if (e.pointerId === dedo) dedo = null;
  };
  for (const tipo of ['pointerup', 'pointercancel', 'pointerleave'] as const) {
    vit.addEventListener(tipo, solta);
  }

  mostra(0);
  return {
    gira: (delta) => daPessoa(quadro + delta),
    giraSozinho() {
      // Sempre do zero: reabrir a loja nao empilha um relogio sobre o outro.
      para();
      if (reduz) return;
      relogio = setInterval(() => mostra(quadro + 1), intervalo);
    },
    para,
  };
}
