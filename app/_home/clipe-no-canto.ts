import { depoisDaPintura } from './depois-da-pintura';

/**
 * O teaser do Blick no canto VHS do topo (pedido do dono).
 *
 * O canto e a caixa de 160x90 do grao (#grain), atras do P da barra. O video
 * entra por baixo do grao, na mesma caixa, e o grao continua por cima: o
 * clipe aparece como uma fita chiando, e o P, que esta na barra com
 * `mix-blend-mode: difference`, continua legivel. A caixa nao cresce.
 *
 * Nada disto pode pesar na abertura: o video e uma versao de 320x180 sem
 * audio (lib/marca/gera-clipe.mjs), nasce com `preload="none"` e sem `src`,
 * e o `src` so e escrito com a intro fechada, depois de uma pintura e de um
 * momento ocioso. So aparece (fade curto) quando de fato toca; se o navegador
 * recusar o autoplay ou o arquivo falhar, ele some e fica o grao de antes.
 *
 * Movimento reduzido ou economia de dados: nada toca, e o canto mostra o
 * quadro parado da capa.
 */
type Opcoes = {
  src: string;
  capa: string;
  reduz: boolean;
};

type ComEconomia = Navigator & { connection?: { saveData?: boolean } };

export function ligaClipeNoCanto(doc: Document, janela: Window, { src, capa, reduz }: Opcoes) {
  const video = doc.getElementById('canto') as HTMLVideoElement | null;
  if (!video || !src || video.dataset.ligado) return Promise.resolve();
  video.dataset.ligado = '1';
  const parado = reduz || Boolean((janela.navigator as ComEconomia).connection?.saveData);

  return depoisDaPintura(janela).then(() => {
    if (parado) {
      if (!capa) return;
      video.poster = capa;
      video.classList.add('on', 'parado');
      return;
    }

    let falhou = false;
    const volta = () => {
      falhou = true;
      video.classList.remove('on');
      video.pause();
      video.removeAttribute('src');
      video.load();
    };
    const toca = () => {
      if (falhou || doc.hidden) return;
      const p = video.play();
      // Autoplay recusado (economia de bateria, politica do navegador): o
      // canto continua sendo so o grao. `AbortError` e so a aba escondendo
      // no meio do play: ele volta quando ela aparecer.
      if (p && typeof p.catch === 'function') {
        p.catch((e: unknown) => {
          if ((e as { name?: string } | null)?.name !== 'AbortError') volta();
        });
      }
    };

    video.muted = true;
    video.defaultMuted = true;
    video.loop = true;
    video.playsInline = true;
    video.addEventListener('error', volta, { once: true });
    video.addEventListener('playing', () => video.classList.add('on'), { once: true });
    doc.addEventListener('visibilitychange', () => {
      if (doc.hidden) video.pause();
      else toca();
    });
    video.src = src;
    toca();
  });
}
