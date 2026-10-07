'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';
import { levaAteAAncora } from '@/lib/ancora';
import { fechaAbertura } from './abertura';
import montaConcierge from './concierge';
import { CONFIG } from './config';
import { desafioDoConvite } from './desafio-do-convite';

// three.js, GLTFLoader, GSAP e ScrollTrigger entram por dynamic import: ficam
// fora do bundle inicial e fora de qualquer rota que nao seja a home (Issue #47).
// O script original le esses quatro como globais, entao eles sao atribuidos ao
// window antes do init, do mesmo jeito que as tags <script> do CDN faziam.
export default function HomeRuntime() {
  useEffect(() => {
    let cancelado = false;
    let soltaAncora = () => {};

    // Quem clica em 'pular' antes de o chunk do three chegar nao clica a toa
    // (#238). O clique fica anotado e o script, ao chegar, pula a intro na
    // hora. Anotado, e nao executado: fechar a abertura aqui mostraria a
    // pagina com os botoes ainda mudos — Comprar, som, convite, concierge sao
    // ligados pelo script —, e um 'pular' que entrega uma pagina que nao
    // responde e pior que um que demora. Depois do init, com sucesso ou nao,
    // o listener sai: a intro tem o dela, e o fracasso fecha tudo sozinho.
    let pulou = false;
    const anota = new AbortController();
    document.getElementById('skip')?.addEventListener(
      'click',
      () => {
        pulou = true;
      },
      { signal: anota.signal }
    );

    (async () => {
      try {
        const [THREE, gltf, gsapMod, stMod, legacy] = await Promise.all([
          import('three'),
          import('three/examples/jsm/loaders/GLTFLoader.js'),
          import('gsap'),
          import('gsap/ScrollTrigger'),
          import('./legacy-site'),
        ]);

        if (cancelado) return;

        const w = window as unknown as Record<string, unknown>;
        const three = { ...THREE, GLTFLoader: gltf.GLTFLoader };

        w.THREE = three;
        w.gsap = gsapMod.gsap;
        w.ScrollTrigger = stMod.ScrollTrigger;

        gsapMod.gsap.registerPlugin(stMod.ScrollTrigger);

        // A protecao contra bot do convite (#28) entra por aqui, e nao por
        // global: o script legado so conhece o que recebe.
        legacy.default(CONFIG, {
          humano: desafioDoConvite(document.getElementById('desafioConvite')),
          pulou,
        });
      } catch (erro) {
        if (cancelado) return;
        // A abertura nunca prende ninguem (#238). Chunk que nao baixou, init
        // que lancou antes de a intro existir — seja o que for, `#intro` e um
        // painel fixo cobrindo a pagina inteira, e sem isto ficava la para
        // sempre, com um 'pular' morto. Fecha pelo mesmo caminho do pular e
        // conta ao Sentry: a home sem cena e um aviso, nao um silencio.
        fechaAbertura(document);
        Sentry.captureException(erro, { tags: { onde: 'home-init' } });
      } finally {
        anota.abort();
      }

      if (cancelado) return;

      // O Concierge (#191) e um modulo proprio, fora do script legado: nasce
      // em TypeScript e nao precisa de nada do three/GSAP. Entra depois do
      // init pelo mesmo motivo da ancora: a intro ja decidiu a trava. E entra
      // mesmo quando o init falhou — a pagina em HTML continua sendo a home.
      montaConcierge({
        humano: desafioDoConvite(document.getElementById('desafioConcierge'), 'concierge'),
      });

      // Depois do init, nao antes: e neste instante que a intro ja pos (ou nao
      // pos) a trava de rolagem, e e a trava que diz se ha o que esperar antes
      // de levar a pessoa ate a ancora com que ela chegou. (Issue #92.)
      soltaAncora = levaAteAAncora(window);
    })();

    return () => {
      cancelado = true;
      anota.abort();
      soltaAncora();
    };
  }, []);

  return null;
}
