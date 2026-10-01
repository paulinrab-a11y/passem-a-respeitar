'use client';

import { useEffect } from 'react';
import { levaAteAAncora } from '@/lib/ancora';
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

    (async () => {
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
      });

      // O Concierge (#191) e um modulo proprio, fora do script legado: nasce
      // em TypeScript e nao precisa de nada do three/GSAP. Entra depois do
      // init pelo mesmo motivo da ancora: a intro ja decidiu a trava.
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
      soltaAncora();
    };
  }, []);

  return null;
}
