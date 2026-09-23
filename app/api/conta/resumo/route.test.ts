import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';

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
    const corpo = await (await GET()).json();

    expect(corpo).toEqual({ logado: true, nome: 'Santxx Oliveira', iniciais: 'SO' });
  });

  it('nao diz nada alem disso para quem nao esta', async () => {
    logado = false;
    const corpo = await (await GET()).json();

    expect(corpo).toEqual({ logado: false });
  });

  // A barra precisa de nome e iniciais, e nada mais. E-mail, data de criacao e
  // URL da foto ficariam num JSON que qualquer extensao de navegador le.
  it('nao vaza e-mail, data nem foto', async () => {
    const texto = JSON.stringify(await (await GET()).json());

    for (const proibido of ['exemplo.invalid', '2026-08-15', 'storage.invalid', 'token=']) {
      expect(texto).not.toContain(proibido);
    }
  });

  it('tem exatamente tres campos quando logado', async () => {
    const corpo = await (await GET()).json();
    expect(Object.keys(corpo).sort()).toEqual(['iniciais', 'logado', 'nome']);
  });

  // A resposta depende de cookie. Cacheada em qualquer ponto do caminho — CDN,
  // proxy da operadora — ela mostraria o nome de uma pessoa para outra.
  it('proibe cache', async () => {
    const cache = (await GET()).headers.get('Cache-Control') ?? '';

    expect(cache).toContain('no-store');
    expect(cache).toContain('private');
  });

  it('aguenta perfil sem nome', async () => {
    const corpo = await (await GET()).json();
    expect(corpo.iniciais).toBeTruthy();
  });
});
