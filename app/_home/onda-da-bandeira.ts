/**
 * A bandeira da Occupation ondulando (pedido do dono, acima do pre-save).
 *
 * O tecido e fatiado em tiras verticais paralelas ao mastro. Cada tira sobe e
 * desce numa senoide (`translateY`) e inclina na mesma senoide adiantada de um
 * quarto de volta (`skewY`): a inclinacao e a derivada da altura, e e ela que
 * faz a borda de uma tira encontrar a da vizinha sem degrau. A fase atrasa a
 * partir do mastro (a onda corre para a ponta solta) e a amplitude cresce com
 * a distancia dele: junto ao mastro o tecido quase nao mexe.
 *
 * So `transform`, num keyframe de dois pontos com a curva do seno
 * (`cubic-bezier(.37,0,.63,1)`) e `alternate`: de -A a +A e de volta, isso e
 * uma senoide exata, no compositor. Os numeros de cada tira saem daqui como
 * variaveis CSS; o keyframe e um so (globals.css).
 */

/** Tiras do tecido. Com o pano a ~110 px de largura no desktop, ~4,5 px cada. */
export const TIRAS = 24;
/** Meia volta, em segundos: a onda completa leva o dobro. */
export const MEIA_VOLTA = 2;
/** Amplitude na ponta solta, em % da altura do pano. */
const AMPLITUDE = 5;
/** Comprimento da onda, em larguras do pano. */
const COMPRIMENTO = 1.1;
/** Quanto a amplitude acelera do mastro para a ponta. */
const CURVA = 1.4;

export type Onda = {
  /** Amplitude de `translateY`, em % da altura da tira. */
  a: number;
  /** Inclinacao maxima, em graus. */
  k: number;
  /** `animation-delay` da subida (negativo: a tira ja nasce no meio da onda). */
  d: number;
  /** `animation-delay` da inclinacao: perto de um quarto de volta adiante. */
  d2: number;
};

const arred = (n: number, casas = 3) => Math.round(n * 10 ** casas) / 10 ** casas;

/**
 * Os numeros de cada tira, da esquerda (ponta solta) para a direita (mastro).
 * @param proporcao altura / largura do pano
 */
export function ondas(proporcao: number, n = TIRAS): Onda[] {
  const volta = 2 * MEIA_VOLTA;
  // Numero de onda por largura do pano, em radianos.
  const k = (2 * Math.PI) / COMPRIMENTO;
  return Array.from({ length: n }, (_, i) => {
    // Distancia do centro da tira ao mastro, em larguras do pano (0..1).
    const dist = (n - i - 0.5) / n;
    const a = AMPLITUDE * dist ** CURVA;
    // A altura e y = -A(dist) cos(wt - k*dist). A inclinacao e a derivada em
    // x (para o mastro): A' cos + A k sen, que e outra senoide, com amplitude
    // R e fase psi. Contar o A' (a amplitude crescendo) e o que deixa as tiras
    // se encontrarem sem degrau tambem onde a onda cresce rapido.
    const derivada = AMPLITUDE * CURVA * dist ** (CURVA - 1);
    const escala = proporcao / 100;
    const inclinacao = Math.atan(escala * Math.hypot(derivada, a * k));
    const psi = Math.atan2(a * k, derivada);
    // A tira mais longe do mastro esta atrasada.
    const atraso = ((k * dist) / Math.PI) * MEIA_VOLTA;
    const inicio = (volta - (atraso % volta)) % volta;
    const inicioDaDobra = (inicio + ((Math.PI - psi) / Math.PI) * MEIA_VOLTA) % volta;
    return {
      a: arred(a),
      k: arred((inclinacao * 180) / Math.PI, 2),
      d: -arred(inicio),
      d2: -arred(inicioDaDobra),
    };
  });
}

/**
 * So ondula na tela e com a aba a vista. A classe `ondula` solta o
 * `animation-play-state`; sem ela, as tiras ficam paradas onde estao.
 * Sem IntersectionObserver, ondula sempre que a aba esta a vista.
 */
export function vigiaBandeira(el: Element, janela: Window): () => void {
  const Observador = (janela as Window & { IntersectionObserver?: typeof IntersectionObserver })
    .IntersectionObserver;
  let naTela = !Observador;
  const aplica = () => el.classList.toggle('ondula', naTela && !janela.document.hidden);
  janela.document.addEventListener('visibilitychange', aplica);
  const vigia = Observador
    ? new Observador((es) => {
        naTela = es.some((e) => e.isIntersecting);
        aplica();
      })
    : null;
  vigia?.observe(el);
  aplica();
  return () => {
    vigia?.disconnect();
    janela.document.removeEventListener('visibilitychange', aplica);
  };
}
