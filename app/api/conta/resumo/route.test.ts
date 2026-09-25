import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';

/** IP novo a cada request: o limite por IP (#22) guarda estado no modulo. */
let n = 0;
const pede = (ip = `203.0.113.${(n++ % 200) + 1}`) =>
  new NextRequest('https://passem-a-respeitar.test/api/conta/resumo', {
    headers: { 'x-forwarded-for': ip },
  });

const perfil = {
  nome: 'Santxx Oliveira',
  email: 'pessoa@exemplo.invalid',
  emailVerificado: true,
  criadoEm: '2026-08-15T09:00:00Z',
  fotoUrl: 'https://storage.invalid/assinada?token=abc',
};

let logado = true;

vi.mock('@/lib/conta/perfil', async (original) => {
  const real = await original<typeof import('@/lib/conta/perfil')>();
  return {
    // `iniciais` e funcao pura: usar a de verdade e melhor que inventar outra.
    iniciais: real.iniciais,
    perfilDaSessao: async () => (logado ? perfil : null),
  };
});

beforeEach(() => {
  logado = true;
});

describe('GET /api/conta/resumo', () => {
  it('diz quem e para quem esta logado', async () => {
    const corpo = await (await GET(pede())).json();

    expect(corpo).toEqual({ logado: true, nome: 'Santxx Oliveira', iniciais: 'SO' });
  });

  it('nao diz nada alem disso para quem nao esta', async () => {
    logado = false;
    const corpo = await (await GET(pede())).json();

    expect(corpo).toEqual({ logado: false });
  });

  // A barra precisa de nome e iniciais, e nada mais. E-mail, data de criacao e
  // URL da foto ficariam num JSON que qualquer extensao de navegador le.
  it('nao vaza e-mail, data nem foto', async () => {
    const texto = JSON.stringify(await (await GET(pede())).json());

    for (const proibido of ['exemplo.invalid', '2026-08-15', 'storage.invalid', 'token=']) {
      expect(texto).not.toContain(proibido);
    }
  });

  it('tem exatamente tres campos quando logado', async () => {
    const corpo = await (await GET(pede())).json();
    expect(Object.keys(corpo).sort()).toEqual(['iniciais', 'logado', 'nome']);
  });

  // A resposta depende de cookie. Cacheada em qualquer ponto do caminho — CDN,
  // proxy da operadora — ela mostraria o nome de uma pessoa para outra.
  it('proibe cache', async () => {
    const cache = (await GET(pede())).headers.get('Cache-Control') ?? '';

    expect(cache).toContain('no-store');
    expect(cache).toContain('private');
  });

  it('aguenta perfil sem nome', async () => {
    const corpo = await (await GET(pede())).json();
    expect(corpo.iniciais).toBeTruthy();
  });
});

describe('limite por IP (#22)', () => {
  it('bloqueia a 121a do mesmo IP no minuto, com Retry-After', async () => {
    const ip = '198.51.100.77';
    for (let i = 0; i < 120; i++) {
      expect((await GET(pede(ip))).status).toBe(200);
    }

    const bloqueado = await GET(pede(ip));

    expect(bloqueado.status).toBe(429);
    expect(bloqueado.headers.get('Retry-After')).toMatch(/^d+$/);
    // Bloqueado nao conta nada: nem que existe alguem logado.
    expect(await bloqueado.json()).toEqual({ logado: false });
  });
});
