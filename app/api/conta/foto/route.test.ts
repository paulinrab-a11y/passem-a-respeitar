import sharp from 'sharp';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

let n = 0;
let usuario: { id: string } | null = null;

const upload = vi.fn(async (_c: string, _b: Buffer, _o: unknown) => ({
  error: null as { message: string } | null,
}));
const remove = vi.fn(async (_c: string[]) => ({ error: null }));
const createSignedUrl = vi.fn(async (_c: string, _s: number) => ({
  data: { signedUrl: 'https://storage.invalid/assinada?token=abc' },
}));

let caminhoAntigo: string | null = null;
const updateAdmin = vi.fn(() => ({ eq: eqAdmin }));
const eqAdmin = vi.fn(async () => ({ error: null as { message: string } | null }));

vi.mock('@/lib/supabase/servidor', () => ({
  usuarioDaSessao: async () => usuario,
  clienteServidor: async () => ({
    storage: { from: () => ({ upload, remove, createSignedUrl }) },
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: { foto_caminho: caminhoAntigo } }) }),
      }),
    }),
  }),
}));

vi.mock('@/lib/supabase/admin', () => ({
  clienteAdmin: () => ({ from: () => ({ update: updateAdmin }) }),
}));

async function png(lado = 300) {
  return sharp({ create: { width: lado, height: lado, channels: 3, background: '#e0161f' } })
    .png()
    .toBuffer();
}

function pede(arquivo: File | null, cabecalhos: Record<string, string> = {}) {
  const corpo = new FormData();
  if (arquivo) corpo.append('foto', arquivo);
  return new Request('https://passem-a-respeitar.test/api/conta/foto', {
    method: 'POST',
    headers: cabecalhos,
    body: corpo,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  upload.mockResolvedValue({ error: null });
  eqAdmin.mockResolvedValue({ error: null });
  caminhoAntigo = null;
  // Usuario novo a cada caso: o rate limit guarda estado no modulo.
  usuario = { id: `11111111-2222-3333-4444-${String(n++).padStart(12, '0')}` };
});

describe('sessao', () => {
  it('recusa quem nao esta logado', async () => {
    usuario = null;
    const r = await POST(pede(new File([await png()], 'f.png', { type: 'image/png' })));

    expect(r.status).toBe(401);
    expect(upload).not.toHaveBeenCalled();
  });
});

describe('validacao', () => {
  it('aceita um PNG de verdade e devolve URL assinada', async () => {
    const r = await POST(pede(new File([await png()], 'f.png', { type: 'image/png' })));
    const corpo = await r.json();

    expect(r.status).toBe(200);
    expect(corpo.url).toContain('token=');
  });

  // Os tres casos que a Issue #26 manda testar, agora contra a rota inteira.
  it('recusa PHP renomeado para .png', async () => {
    const arquivo = new File(['<?php system($_GET["c"]); ?>'], 'shell.png', {
      type: 'image/png',
    });
    const r = await POST(pede(arquivo));

    expect(r.status).toBe(400);
    expect(upload).not.toHaveBeenCalled();
  });

  it('recusa SVG', async () => {
    const arquivo = new File(['<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'], 'x.svg', {
      type: 'image/svg+xml',
    });
    const r = await POST(pede(arquivo));

    expect(r.status).toBe(400);
    expect(upload).not.toHaveBeenCalled();
  });

  // Corta pelo content-length, antes de ler o corpo: um POST de 500 MB nao
  // pode ser lido inteiro na memoria so para ser recusado no fim.
  it('recusa pelo content-length antes de ler o corpo', async () => {
    const r = await POST(
      pede(new File([await png()], 'f.png', { type: 'image/png' }), {
        'content-length': String(50 * 1024 * 1024),
      })
    );

    expect(r.status).toBe(413);
    expect(upload).not.toHaveBeenCalled();
  });

  it('recusa quando nao vem arquivo', async () => {
    const r = await POST(pede(null));
    expect(r.status).toBe(400);
  });

  it('recusa imagem truncada que passa pelos bytes magicos', async () => {
    // Cabecalho PNG valido e resto cortado: o sharp recusa.
    const inteiro = await png();
    const cortado = inteiro.subarray(0, 40);
    const r = await POST(pede(new File([cortado], 'f.png', { type: 'image/png' })));

    expect(r.status).toBe(400);
    expect(upload).not.toHaveBeenCalled();
  });
});

describe('gravacao', () => {
  it('guarda como webp na pasta do dono, sem o nome original', async () => {
    await POST(pede(new File([await png()], 'minha foto do rolê.png', { type: 'image/png' })));

    const [caminho, , opcoes] = upload.mock.calls[0];
    expect(caminho.startsWith(`${usuario?.id}/`)).toBe(true);
    expect(caminho).not.toContain('rolê');
    expect(caminho.endsWith('.webp')).toBe(true);
    expect(opcoes).toMatchObject({ contentType: 'image/webp', upsert: false });
  });

  it('o que sobe e webp 512x512, nao o original', async () => {
    await POST(pede(new File([await png(900)], 'f.png', { type: 'image/png' })));

    const meta = await sharp(upload.mock.calls[0][1]).metadata();
    expect(meta.format).toBe('webp');
    expect([meta.width, meta.height]).toEqual([512, 512]);
  });

  it('grava o caminho no perfil filtrando pelo id da sessao', async () => {
    await POST(pede(new File([await png()], 'f.png', { type: 'image/png' })));

    expect(updateAdmin).toHaveBeenCalledWith({ foto_caminho: upload.mock.calls[0][0] });
    // O admin ignora RLS: sem o eq, um erro aqui reescreveria a tabela inteira.
    expect(eqAdmin).toHaveBeenCalledWith('id', usuario?.id);
  });

  it('apaga a foto anterior para o bucket nao crescer para sempre', async () => {
    caminhoAntigo = `${usuario?.id}/antiga.webp`;
    await POST(pede(new File([await png()], 'f.png', { type: 'image/png' })));

    expect(remove).toHaveBeenCalledWith([caminhoAntigo]);
  });

  it('nao tenta apagar nada quando nao havia foto', async () => {
    await POST(pede(new File([await png()], 'f.png', { type: 'image/png' })));
    expect(remove).not.toHaveBeenCalled();
  });

  it('avisa quando o storage recusa', async () => {
    upload.mockResolvedValue({ error: { message: 'falhou' } });
    const r = await POST(pede(new File([await png()], 'f.png', { type: 'image/png' })));

    expect(r.status).toBe(502);
    expect(updateAdmin).not.toHaveBeenCalled();
  });

  // Arquivo no bucket sem ninguem apontando para ele e lixo que nunca mais sai.
  it('desfaz o upload quando o perfil nao aceita o caminho', async () => {
    eqAdmin.mockResolvedValue({ error: { message: 'falhou' } });
    const r = await POST(pede(new File([await png()], 'f.png', { type: 'image/png' })));

    expect(r.status).toBe(500);
    expect(remove).toHaveBeenCalledWith([upload.mock.calls[0][0]]);
  });
});

describe('rate limit', () => {
  it('para na decima primeira troca seguida', async () => {
    const arquivo = async () => new File([await png()], 'f.png', { type: 'image/png' });

    for (let i = 0; i < 10; i++) {
      expect((await POST(pede(await arquivo()))).status).toBe(200);
    }

    const bloqueado = await POST(pede(await arquivo()));
    expect(bloqueado.status).toBe(429);
    expect(bloqueado.headers.get('Retry-After')).toMatch(/^\d+$/);
  });

  // Por usuario, e nao por IP: quem ja esta logado nao precisa de botnet para
  // encher o bucket, basta um laco.
  it('o limite de um usuario nao atinge outro', async () => {
    const arquivo = async () => new File([await png()], 'f.png', { type: 'image/png' });
    for (let i = 0; i < 11; i++) await POST(pede(await arquivo()));

    usuario = { id: `11111111-2222-3333-4444-${String(n++).padStart(12, '0')}` };
    expect((await POST(pede(await arquivo()))).status).toBe(200);
  });
});
