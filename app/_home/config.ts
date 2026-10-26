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
    igSantxx: string;
    igChefe: string;
    igLabel: string;
  };
  logoUrl: string;
  /** Paragrafo "quem sao" (#275). Vazio: a secao nao aparece. */
  quemSao: string;
  clipe: {
    /** O video do player de #clipe (telas grandes). Vazio: a secao diz "em breve". */
    blick: string;
    /** O mesmo, mais leve, para telas pequenas. */
    blickLeve: string;
    /** Capa do player, enquanto ninguem deu play. */
    capa: string;
    /** O loop mudo e minusculo do canto VHS do topo. Vazio: so o grao. */
    canto: string;
    /** Quadro parado do canto, para quem pediu menos movimento. */
    cantoCapa: string;
  };
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
    // Pre-save do EP no Feature.fm, mandado pelo dono.
    preSave: 'https://ffm.to/xy6qv01',
    igSantxx: 'https://instagram.com/ogsantxx',
    igChefe: 'https://instagram.com/ch3fe3k',
    igLabel: 'https://instagram.com/whynotvisuals_',
  },
  logoUrl: '/logo.png',
  // Texto aprovado pelo dono (#275, #386). So o que ele escreveu: nada de
  // data, cidade de nascimento, faixa ou numero. O "trap" daqui e o que
  // autoriza o `genre` dos MusicGroup no JSON-LD (ver app/page.tsx).
  quemSao:
    'Santxx e Ch3fe são dois nomes do trap de São Paulo. Passem a Respeitar é o EP que os dois assinam juntos, pela Whynot Visuals.',
  // O teaser do Blick mora no proprio site, em public/clipe/ (#75), servido
  // pelo CDN da Vercel como os outros assets. Antes era um id do Drive no HTML,
  // material inedito baixavel por quem copiasse o id; depois ficou vazio
  // esperando o YouTube. O dono decidiu hospedar aqui: sem iframe de terceiro,
  // sem frame-src novo na CSP (o video e media-src 'self').
  //
  // Os arquivos saem de lib/marca/gera-clipe.mjs a partir do original do
  // dono (HEVC, que nao toca em varios navegadores): H.264 em 1080p e 720p,
  // a capa, e o loop do canto. Com `blick` vazio a secao volta a dizer
  // "clipe em breve" e o script nao monta nada.
  clipe: {
    blick: '/clipe/blick-teaser-1080.mp4',
    blickLeve: '/clipe/blick-teaser-720.mp4',
    capa: '/clipe/blick-teaser-poster.webp',
    canto: '/clipe/blick-canto.mp4',
    cantoCapa: '/clipe/blick-canto-poster.webp',
  },
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
  // WebP em 1024 px com perda leve (#366), gerados por
  // lib/marca/gera-elementos.mjs a partir dos originais sem perda da #145
  // (1600 e 2000 px, os mesmos pixels dos PNGs), que ficam no historico do
  // git. O alpha vai sem perda e os transparentes continuam pretos, porque o
  // shader le a cor deles na borda; app/elementos-em-webp.test.ts confere.
  elementos: [
    { nome: 'corrente', url: '/elementos/corrente.webp', elo: 0, escala: 1.7, lado: -1 },
    { nome: 'mao', url: '/elementos/mao.webp', elo: 1, escala: 1.2, lado: 1 },
    { nome: 'saturno', url: '/elementos/saturno.webp', elo: 2, escala: 1.3, lado: -1 },
    { nome: 'p', url: '/elementos/p.webp', elo: 3, escala: 1.25, lado: 1 },
    { nome: 'pistola', url: '/elementos/pistola.webp', elo: 4, escala: 1.5, lado: -1 },
  ],
  audio: {},
  // As duas vitrines (#217): o modelo 3D e a regra; as quatro fotos em 360
  // entram quando a GPU e por software (CI, VM, aparelho sem driver), quando
  // nao ha WebGL ou quando o modelo nao esta configurado. A escolha e do
  // legacy-site, em querFotos().
  merch360: '/merch/camiseta-360.webp',
  merchModelo: '/merch/camiseta.gltf',
  beats: [
    { nome: 'Mais um hit · 142 · Fm', url: '/beats/mais-um-hit.mp3' },
    { nome: 'Beat 1 / Beat 2 · 146 · Cm', url: '/beats/beat-1-2.mp3' },
    { nome: 'Detroit · 81 · Am', url: '/beats/detroit.mp3' },
    { nome: 'Rage · 140 · C#m', url: '/beats/rage.mp3' },
  ],
};
