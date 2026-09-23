import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { caminhoDaFoto, normalizaFoto, TAMANHO_MAX, tipoRealDe, validaFoto } from './foto';

/** Imagens de verdade, feitas na hora. Byte inventado a mao nao prova nada. */
async function imagem(formato: 'jpeg' | 'png' | 'webp', largura = 200, altura = 200) {
  const base = sharp({
    create: { width: largura, height: altura, channels: 3, background: '#e0161f' },
  });
  return new Uint8Array(await base[formato]().toBuffer());
}

const bytesDe = (texto: string) => new TextEncoder().encode(texto);

describe('tipoRealDe', () => {
  it.each(['jpeg', 'png', 'webp'] as const)('reconhece %s pelos bytes', async (formato) => {
    expect(tipoRealDe(await imagem(formato))).toBe(`image/${formato}`);
  });

  // Os tres casos que a Issue #26 manda testar.
  it('recusa SVG', () => {
    expect(tipoRealDe(bytesDe('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'))).toBe(
      null
    );
  });

  it('recusa PHP', () => {
    expect(tipoRealDe(bytesDe('<?php system($_GET["c"]); ?>'))).toBe(null);
  });

  it('recusa arquivo vazio', () => {
    expect(tipoRealDe(new Uint8Array())).toBe(null);
  });

  it('recusa RIFF que nao e WEBP', () => {
    // Um .wav comeca com RIFF tambem. So os bytes 8..11 separam os dois.
    const wav = new Uint8Array(16);
    wav.set(bytesDe('RIFF'), 0);
    wav.set(bytesDe('WAVE'), 8);
    expect(tipoRealDe(wav)).toBe(null);
  });
});

describe('validaFoto', () => {
  it('aceita um PNG de verdade', async () => {
    const bytes = await imagem('png');
    const r = validaFoto({ nome: 'foto.png', tamanho: bytes.byteLength, bytes });
    expect(r).toEqual({ ok: true, tipo: 'image/png' });
  });

  it('aceita .jpeg alem de .jpg', async () => {
    const bytes = await imagem('jpeg');
    expect(validaFoto({ nome: 'foto.JPEG', tamanho: bytes.byteLength, bytes }).ok).toBe(true);
  });

  // "Tentar subir um .php renomeado para .png. Deve ser recusado."
  it('recusa PHP renomeado para .png', () => {
    const bytes = bytesDe('<?php system($_GET["c"]); ?>');
    const r = validaFoto({ nome: 'shell.png', tamanho: bytes.byteLength, bytes });

    expect(r.ok).toBe(false);
    // A extensao passa; quem barra sao os bytes. E esse o ponto do teste.
    expect((r as { motivo: string }).motivo).toMatch(/não é uma imagem/);
  });

  it('recusa SVG pela extensao', () => {
    const bytes = bytesDe('<svg/>');
    expect(validaFoto({ nome: 'x.svg', tamanho: bytes.byteLength, bytes }).ok).toBe(false);
  });

  it('recusa SVG disfarcado de png', () => {
    const bytes = bytesDe('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>');
    expect(validaFoto({ nome: 'x.png', tamanho: bytes.byteLength, bytes }).ok).toBe(false);
  });

  it('recusa arquivo de 10 MB', async () => {
    const bytes = await imagem('png');
    const r = validaFoto({ nome: 'grande.png', tamanho: 10 * 1024 * 1024, bytes });

    expect(r.ok).toBe(false);
    expect((r as { motivo: string }).motivo).toMatch(/2 MB/);
  });

  it('aceita exatamente no limite', async () => {
    const bytes = await imagem('png');
    expect(validaFoto({ nome: 'ok.png', tamanho: TAMANHO_MAX, bytes }).ok).toBe(true);
  });

  it('recusa um byte acima do limite', async () => {
    const bytes = await imagem('png');
    expect(validaFoto({ nome: 'ok.png', tamanho: TAMANHO_MAX + 1, bytes }).ok).toBe(false);
  });

  it('recusa arquivo vazio', () => {
    expect(validaFoto({ nome: 'x.png', tamanho: 0, bytes: new Uint8Array() }).ok).toBe(false);
  });

  it('recusa extensao dupla', () => {
    const bytes = bytesDe('<?php ?>');
    expect(validaFoto({ nome: 'foto.png.php', tamanho: bytes.byteLength, bytes }).ok).toBe(false);
  });
});

describe('normalizaFoto', () => {
  it('reescreve em webp 512x512', async () => {
    const saida = await normalizaFoto(await imagem('jpeg', 1000, 600));
    const meta = await sharp(saida).metadata();

    expect(meta.format).toBe('webp');
    expect(meta.width).toBe(512);
    expect(meta.height).toBe(512);
  });

  it('aumenta imagem pequena ate o lado certo, sem deixar buraco', async () => {
    const meta = await sharp(await normalizaFoto(await imagem('png', 80, 80))).metadata();
    expect([meta.width, meta.height]).toEqual([512, 512]);
  });

  // Camera de celular grava GPS no EXIF. Uma foto de perfil nao precisa contar
  // onde a pessoa mora, e reescrever a imagem joga isso fora junto.
  it('descarta o EXIF', async () => {
    const comExif = await sharp({
      create: { width: 300, height: 300, channels: 3, background: '#000' },
    })
      .withExif({ IFD0: { Copyright: 'teste', Software: 'camera-inventada' } })
      .jpeg()
      .toBuffer();

    expect((await sharp(comExif).metadata()).exif).toBeDefined();
    expect((await sharp(await normalizaFoto(comExif)).metadata()).exif).toBeUndefined();
  });

  it('recusa bytes que nao sao imagem', async () => {
    await expect(normalizaFoto(bytesDe('<?php ?>'))).rejects.toThrow();
  });
});

describe('caminhoDaFoto', () => {
  it('joga fora o nome original e guarda na pasta do dono', () => {
    const id = '11111111-2222-3333-4444-555555555555';
    const caminho = caminhoDaFoto(id);

    expect(caminho.startsWith(`${id}/`)).toBe(true);
    expect(caminho.endsWith('.webp')).toBe(true);
  });

  // O caminho tem que casar com o check constraint da coluna e com a policy
  // do storage, que le a pasta como o id do dono.
  it('bate com o formato que o banco exige', () => {
    const id = '11111111-2222-3333-4444-555555555555';
    expect(caminhoDaFoto(id)).toMatch(/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.webp$/);
  });

  it('nao repete caminho', () => {
    const id = '11111111-2222-3333-4444-555555555555';
    expect(caminhoDaFoto(id)).not.toBe(caminhoDaFoto(id));
  });
});
