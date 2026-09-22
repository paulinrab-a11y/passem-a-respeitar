'use client';

import { useEffect } from 'react';
import { CONFIG } from './config';

// three.js, GLTFLoader, GSAP e ScrollTrigger entram por dynamic import: ficam
// fora do bundle inicial e fora de qualquer rota que nao seja a home (Issue #47).
// O script original le esses quatro como globais, entao eles sao atribuidos ao
// window antes do init, do mesmo jeito que as tags <script> do CDN faziam.
export default function HomeRuntime() {
  useEffect(() => {
    let cancelado = false;

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

      legacy.default(CONFIG);
    })();

    return () => {
      cancelado = true;
    };
  }, []);

  return null;
}
