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
    igLabel: 'https://instagram.com/whynotvisuals_',
  },
  logoUrl: '/logo.png',
  // Vazio de proposito ate o clipe subir no YouTube (#75). Com string vazia
  // o script nao monta iframe nenhum e a secao mostra "clipe em breve".
  //
  // Isso tirou do HTML o id do arquivo no Drive, que era material inedito
  // baixavel por quem copiasse o id. Quando o video existir, o valor vira
  // 'https://www.youtube-nocookie.com/embed/<id>' e o frame-src da CSP volta.
  clipe: { blick: '' },
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
  // WebP sem perda (#145): metade do peso, os mesmos pixels. "Os mesmos" e
  // literal — a impressao digital dos pixels dos PNGs originais esta no teste,
  // e inclui a cor dos pixels transparentes, que o shader le na borda.
  //
  // Os PNGs sairam do repositorio na #166, depois de a textura e a saida do
  // shader serem comparadas dentro do navegador: zero pixel diferente. Quem
  // precisar deles de volta os tem no historico do git, ou decodificando o
  // WebP, que devolve os mesmos bytes.
  elementos: [
    { nome: 'corrente', url: '/elementos/corrente.webp', elo: 0, escala: 1.7, lado: -1 },
    { nome: 'mao', url: '/elementos/mao.webp', elo: 1, escala: 1.2, lado: 1 },
    { nome: 'saturno', url: '/elementos/saturno.webp', elo: 2, escala: 1.3, lado: -1 },
    { nome: 'p', url: '/elementos/p.webp', elo: 3, escala: 1.25, lado: 1 },
    { nome: 'pistola', url: '/elementos/pistola.webp', elo: 4, escala: 1.5, lado: -1 },
  ],
  audio: {},
  // Vazio de proposito (#217): com o modelo proprio da CBAC, a vitrine volta a
  // ser WebGL. O sprite de 4 fotos continua em /public como reserva manual.
  merch360: '',
  merchModelo: '/merch/camiseta.gltf',
  beats: [
    { nome: 'Mais um hit · 142 · Fm', url: '/beats/mais-um-hit.mp3' },
    { nome: 'Beat 1 / Beat 2 · 146 · Cm', url: '/beats/beat-1-2.mp3' },
    { nome: 'Detroit · 81 · Am', url: '/beats/detroit.mp3' },
    { nome: 'Rage · 140 · C#m', url: '/beats/rage.mp3' },
  ],
};
