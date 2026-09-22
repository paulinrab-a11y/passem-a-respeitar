type ElementoCromado = {
  nome: string;
  url: string;
  fallback?: string;
  elo: number;
  escala: number;
  lado: 1 | -1;
};

type Beat = { nome: string; url: string };

export type SiteConfig = {
  fase: number;
  links: {
    preSave: string;
    merch: string;
    igSantxx: string;
    igChefe: string;
    igLabel: string;
  };
  logoUrl: string;
  clipe: { blick: string };
  merchFotos: string[];
  elementos: ElementoCromado[];
  audio: Record<string, string>;
  merch360: string;
  merchModelo: string;
  beats: Beat[];
};

// Issue #14: os assets sairam do Google Drive e do Dropbox e passaram a morar
// em public/, servidos pelo CDN da propria Vercel.
//
// Antes eram links publicos permanentes, sem expiracao e fora do nosso
// controle: qualquer um lia os IDs no HTML e baixava tudo, e o ID do Drive
// ainda entregava de graca a estrutura da pasta de origem.
//
// Os helpers `drive()` e `driveAudio()` do script legado ja deixam passar
// qualquer caminho que comece com `/`, entao nada precisou mudar la.
export const CONFIG: SiteConfig = {
  fase: 4,
  links: {
    preSave: '#',
    merch: '#',
    igSantxx: 'https://instagram.com/ogsantxx',
    igChefe: 'https://instagram.com/ch3fe3k',
    igLabel: 'https://instagram.com/',
  },
  logoUrl: '/logo.png',
  // Unico asset que continua externo: e um iframe do player do Drive, nao um
  // arquivo. Hospedar video e outro problema — ver a Issue de video.
  clipe: { blick: 'https://drive.google.com/file/d/1jyKv_u6NfwK0ImamvkvGX7Y2mQUO14yl/preview' },
  merchFotos: [
    '/merch/camiseta-01.jpg',
    '/merch/camiseta-02.jpg',
    '/merch/camiseta-03.jpg',
    '/merch/camiseta-04.jpg',
    '/merch/camiseta-05.jpg',
    '/merch/camiseta-06.jpg',
    '/merch/camiseta-07.jpg',
    '/merch/camiseta-08.jpg',
    '/merch/camiseta-09.jpg',
  ],
  elementos: [
    { nome: 'corrente', url: '/elementos/corrente.png', elo: 0, escala: 1.7, lado: -1 },
    { nome: 'mao', url: '/elementos/mao.png', elo: 1, escala: 1.2, lado: 1 },
    {
      nome: 'saturno',
      url: '/elementos/saturno.png',
      fallback: '/saturno.png',
      elo: 2,
      escala: 1.3,
      lado: -1,
    },
    { nome: 'p', url: '/elementos/p.png', elo: 3, escala: 1.25, lado: 1 },
    { nome: 'pistola', url: '/elementos/pistola.png', elo: 4, escala: 1.5, lado: -1 },
  ],
  audio: {},
  merch360: '/merch/camiseta-360.webp',
  merchModelo: '/merch/camiseta.glb',
  beats: [
    { nome: 'Mais um hit · 142 · Fm', url: '/beats/mais-um-hit.mp3' },
    { nome: 'Beat 1 / Beat 2 · 146 · Cm', url: '/beats/beat-1-2.mp3' },
    { nome: 'Detroit · 81 · Am', url: '/beats/detroit.mp3' },
    { nome: 'Rage · 140 · C#m', url: '/beats/rage.mp3' },
  ],
};
