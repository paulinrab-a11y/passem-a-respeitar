import { beforeEach, describe, expect, it, vi } from 'vitest';
import { iniciais, perfilDaSessao } from './perfil';

const usuario = {
  id: '11111111-2222-3333-4444-555555555555',
  email: 'pessoa@exemplo.invalid',
  email_confirmed_at: '2026-09-01T10:00:00Z',
  created_at: '2026-08-15T09:00:00Z',
  // Campos que o Supabase devolve junto e que NAO podem aparecer na resposta.
  role: 'authenticated',
  aud: 'authenticated',
  app_metadata: { provider: 'email' },
  phone: '+5511999999999',
};

const linha = {
  nome: 'Santxx',
  criado_em: '2026-08-15T09:00:00Z',
  foto_caminho: null as string | null,
};

let linhaExiste = true;
const select = vi.fn();
const createSignedUrl = vi.fn(async (_c: string, _s: number) => ({
  data: { signedUrl: 'https://storage.invalid/assinada?token=abc' },
}));

const usuarioDaSessao = vi.fn(async () => usuario as unknown);

vi.mock('@/lib/supabase/servidor', () => ({
  usuarioDaSessao: () => usuarioDaSessao(),
  clienteServidor: async () => ({
    from: () => ({
      select: (colunas: string) => {
        select(colunas);
        return {
          eq: () => ({ maybeSingle: async () => ({ data: linhaExiste ? linha : null }) }),
        };
      },
    }),
    storage: { from: () => ({ createSignedUrl }) },
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  usuarioDaSessao.mockResolvedValue(usuario);
  linha.nome = 'Santxx';
  linha.foto_caminho = null;
  linhaExiste = true;
  createSignedUrl.mockResolvedValue({
    data: { signedUrl: 'https://storage.invalid/assinada?token=abc' },
  });
});

describe('perfilDaSessao', () => {
  it('devolve null sem sessao', async () => {
    usuarioDaSessao.mockResolvedValue(null);
    expect(await perfilDaSessao()).toBe(null);
  });

  // O criterio da Issue #20: a resposta tem EXATAMENTE os campos esperados.
  // Devolver a linha inteira e como um vazamento comeca — a linha de hoje e
  // inofensiva, a de amanha tem uma coluna que ninguem lembrou de esconder.
  it('tem exatamente os campos da lista', async () => {
    const perfil = await perfilDaSessao();

    expect(Object.keys(perfil ?? {}).sort()).toEqual([
      'criadoEm',
      'email',
      'emailVerificado',
      'fotoUrl',
      'nome',
    ]);
  });

  it('nao deixa passar nada que veio junto do usuario', async () => {
    const texto = JSON.stringify(await perfilDaSessao());

    for (const proibido of ['authenticated', 'app_metadata', '+5511999999999', 'foto_caminho']) {
      expect(texto).not.toContain(proibido);
    }
  });

  // `select *` traria coluna nova para a resposta sem ninguem decidir.
  it('pede colunas nomeadas, nunca select *', async () => {
    await perfilDaSessao();

    expect(select).toHaveBeenCalledOnce();
    expect(select.mock.calls[0][0]).not.toContain('*');
    expect(select.mock.calls[0][0]).toBe('nome, criado_em, foto_caminho');
  });

  describe('selo de verificado', () => {
    it('verificado quando ha data de confirmacao', async () => {
      expect((await perfilDaSessao())?.emailVerificado).toBe(true);
    });

    // O Supabase guarda a DATA da confirmacao, nao um booleano. Ler isso como
    // verdadeiro-ou-falso direto marcaria todo mundo como verificado.
    it('nao verificado quando a data e null', async () => {
      usuarioDaSessao.mockResolvedValue({ ...usuario, email_confirmed_at: null });
      expect((await perfilDaSessao())?.emailVerificado).toBe(false);
    });
  });

  describe('foto', () => {
    it('fica null quando nao ha caminho, sem pedir URL assinada', async () => {
      const perfil = await perfilDaSessao();

      expect(perfil?.fotoUrl).toBe(null);
      expect(createSignedUrl).not.toHaveBeenCalled();
    });

    it('assina a URL quando ha caminho', async () => {
      linha.foto_caminho = `${usuario.id}/abc.webp`;
      const perfil = await perfilDaSessao();

      expect(createSignedUrl).toHaveBeenCalledWith(linha.foto_caminho, expect.any(Number));
      expect(perfil?.fotoUrl).toContain('token=');
    });

    // URL longa acabaria em cache de CDN e em link compartilhado.
    it('a validade da assinatura e curta', async () => {
      linha.foto_caminho = `${usuario.id}/abc.webp`;
      await perfilDaSessao();

      expect(createSignedUrl.mock.calls[0][1]).toBeLessThanOrEqual(60 * 15);
    });
  });

  // O trigger cria o perfil no signup, mas a tela nao pode explodir se a
  // linha nao existir — um usuario criado antes do trigger, por exemplo.
  it('aguenta perfil que ainda nao existe', async () => {
    linhaExiste = false;
    const perfil = await perfilDaSessao();

    expect(perfil?.nome).toBe(null);
    expect(perfil?.email).toBe(usuario.email);
    // Sem linha, a data vem do proprio usuario em auth.
    expect(perfil?.criadoEm).toBe(usuario.created_at);
  });

  it('aguenta o storage nao devolver assinatura', async () => {
    linha.foto_caminho = `${usuario.id}/abc.webp`;
    createSignedUrl.mockResolvedValue({ data: null as unknown as { signedUrl: string } });

    expect((await perfilDaSessao())?.fotoUrl).toBe(null);
  });

  it('aguenta nome nulo na linha', async () => {
    linha.nome = null as unknown as string;
    expect((await perfilDaSessao())?.nome).toBe(null);
  });
});

describe('iniciais', () => {
  it.each([
    ['Santxx Oliveira', 'SO'],
    ['Santxx', 'SA'],
    ['  Ana  Paula  Souza ', 'AS'],
  ])('de "%s" tira %s', (nome, esperado) => {
    expect(iniciais(nome, 'qualquer@exemplo.com')).toBe(esperado);
  });

  it('cai no e-mail quando nao ha nome', () => {
    expect(iniciais(null, 'joao.silva@exemplo.com')).toBe('JC');
  });

  // Nome so de espaco cai no e-mail, como se nao houvesse nome.
  it('nao quebra com nome so de espaco', () => {
    expect(iniciais('   ', 'joao.silva@exemplo.com')).toBe('JC');
  });

  it('nao quebra com e-mail de uma letra so', () => {
    expect(iniciais(null, 'x@y.z')).toBe('XZ');
  });
});
