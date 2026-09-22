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
  convite: { codigos: string[]; videoEmbed: string };
  logoUrl: string;
  clipe: { blick: string };
  merchFotos: string[];
  elementos: ElementoCromado[];
  audio: Record<string, string>;
  merch360: string;
  merchModelo: string;
  beats: Beat[];
};

export const CONFIG: SiteConfig = {
  fase: 4,
  links: {
    preSave: '#',
    merch: '#',
    igSantxx: 'https://instagram.com/',
    igChefe: 'https://instagram.com/',
    igLabel: 'https://instagram.com/',
  },
  convite: {
    codigos: ['RESPEITO', 'PAR2026'],
    videoEmbed: '',
  },
  logoUrl: '/logo.png',
  clipe: { blick: 'https://drive.google.com/file/d/1jyKv_u6NfwK0ImamvkvGX7Y2mQUO14yl/preview' },
  merchFotos: [
    '1wjzI0PUVH9w6tejQhBEvaT8l4NhTYzK1',
    '1KZL_TJbOZyc82QrFn4tWdG0LxtqYRBH1',
    '1-zGlPTdpGSiomroIVzzWDp2IFLFQVyih',
    '1C54VydW8wkTmMadMFevFzDMYbE41Civq',
    '1fIESXlcSCe_eSKDLr7Qb9fbNIvgUrKQa',
    '1lgCAY_R1Muqu-Othy5cQDBPf9UEFEy-W',
    '1Y6qoLYealg3y7RmvGcoGJfDyK-OwnKyC',
    '1R2TEBEThjeJIkO6D7abELIPYFXE3Juus',
    '1K-M4f5oIQwEz3BT7FopOpQ1-koTo9Jov',
  ],
  elementos: [
    { nome: 'corrente', url: '15XYBpm2JlVMO9pG6kg67hj46DuerRoS0', elo: 0, escala: 1.7, lado: -1 },
    { nome: 'mao', url: '1f8GBYFowlQOGVkW3JiFfp1vJ3kH8XUdY', elo: 1, escala: 1.2, lado: 1 },
    {
      nome: 'saturno',
      url: '1Qjz0lYgolY07wWhd2Wq1VAgnrrYhyCp-',
      fallback: '/saturno.png',
      elo: 2,
      escala: 1.3,
      lado: -1,
    },
    {
      nome: 'p',
      url: 'https://dl.dropboxusercontent.com/scl/fi/qw61th33e747ytthkhv1l/Design-sem-nome-8.png?rlkey=zaip6q7fa05zldar6h5inj1z5&dl=1',
      elo: 3,
      escala: 1.25,
      lado: 1,
    },
    { nome: 'pistola', url: '1eXQaDDriwPo2vRnpE5MTgDmCC7aPWGt4', elo: 4, escala: 1.5, lado: -1 },
  ],
  audio: {},
  merch360:
    'https://dl.dropboxusercontent.com/scl/fi/tkb6galiyau45ay13av5a/camiseta-360.webp?rlkey=hl19hmulmxtlov72wpjpgknyb&dl=1',
  merchModelo:
    'https://dl.dropboxusercontent.com/scl/fi/eo37cgyxoe7aw05mnh1aj/camiseta_3d_site.glb?rlkey=yu658roq6dogefuqpwr0cyn7m&dl=1',
  beats: [
    {
      nome: 'Mais um hit · 142 · Fm',
      url: 'https://dl.dropboxusercontent.com/scl/fi/mbv9b66cdfqzokk96e1fn/mais-um-hit.mp3?rlkey=foev63tooie09k8a2pl329wtu&dl=1',
    },
    {
      nome: 'Beat 1 / Beat 2 · 146 · Cm',
      url: 'https://dl.dropboxusercontent.com/scl/fi/stxyxeajeyv914x89lq3l/beat-1-2.mp3?rlkey=orl9ift0bc023d1gypdlp6ygz&dl=1',
    },
    {
      nome: 'Detroit · 81 · Am',
      url: 'https://dl.dropboxusercontent.com/scl/fi/rddxq50g2ugia6q9ce7ph/detroit.mp3?rlkey=l830ve8d33zen6u390yqzxffi&dl=1',
    },
    {
      nome: 'Rage · 140 · C#m',
      url: 'https://dl.dropboxusercontent.com/scl/fi/0i8sajk046faxf4aejo1l/rage.mp3?rlkey=vfqs857kt5uo8jh8xh4y8e6kr&dl=1',
    },
  ],
};
