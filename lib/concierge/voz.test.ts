import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  assinaResposta,
  assinaturaConfere,
  ESPERA_DA_VOZ_MS,
  fala,
  MODELO_DE_VOZ,
  taxaDoMime,
  VOZ,
  wavDePcm,
} from './voz';

/**
 * A voz do Concierge (#193). O que se prova aqui:
 *
 *   - so texto assinado pela rota do chat passa, e a assinatura nao vale
 *     para outro texto nem depois de vencer
 *   - o PCM do Gemini sai como WAV que um decodificador reconhece
 *   - a chave vai no cabecalho; toda falha e `null`
 */

const captureMessage = vi.fn();
vi.mock('@sentry/nextjs', () => ({
  captureMessage: (...a: unknown[]) => captureMessage(...a),
  flush: async () => true,
}));

// Inventada. A de verdade nunca entra num teste.
const CHAVE = 'chave-de-teste';
const TEXTO = 'Dia 20, mano.';

const pedido = vi.fn<typeof fetch>();

function geminiFala(pcm: Uint8Array, mimeType = 'audio/L16;codec=pcm;rate=24000') {
  const data = Buffer.from(pcm).toString('base64');
  pedido.mockImplementation(
    async () =>
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ inlineData: { mimeType, data } }] } }],
        })
      )
  );
}

beforeEach(() => {
  vi.stubGlobal('fetch', pedido);
  vi.stubEnv('GEMINI_API_KEY', CHAVE);
  pedido.mockReset();
  captureMessage.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('assinatura', () => {
  it('o que a rota do chat assina, a rota da voz aceita', async () => {
    const a = await assinaResposta(TEXTO);
    expect(a).toMatch(/^v1\.\d+\.[0-9a-f]{64}$/);
    expect(await assinaturaConfere(TEXTO, a)).toBe(true);
  });

  it('nao vale para outro texto', async () => {
    const a = await assinaResposta(TEXTO);
    expect(await assinaturaConfere('Outro texto qualquer.', a)).toBe(false);
    expect(await assinaturaConfere(`${TEXTO} `, a)).toBe(false);
  });

  it('vence', async () => {
    const haDuasHoras = Math.floor(Date.now() / 1000) - 2 * 60 * 60;
    const a = await assinaResposta(TEXTO, haDuasHoras);
    expect(await assinaturaConfere(TEXTO, a)).toBe(false);
  });

  it('nao aceita expiracao reescrita', async () => {
    const a = (await assinaResposta(TEXTO)) as string;
    const [v, exp, hmac] = a.split('.');
    expect(await assinaturaConfere(TEXTO, `${v}.${Number(exp) + 99999}.${hmac}`)).toBe(false);
  });

  it.each([
    ['vazia', ''],
    ['sem versao', '1.2.3'],
    ['forjada', `v1.${Math.floor(Date.now() / 1000) + 999}.${'0'.repeat(64)}`],
    ['que nao e texto', 42],
  ])('recusa assinatura %s', async (_nome, a) => {
    expect(await assinaturaConfere(TEXTO, a)).toBe(false);
  });

  it('sem chave nao assina nem confere', async () => {
    const a = await assinaResposta(TEXTO);
    vi.stubEnv('GEMINI_API_KEY', '');
    expect(await assinaResposta(TEXTO)).toBeNull();
    expect(await assinaturaConfere(TEXTO, a)).toBe(false);
  });

  it('muda com a chave', async () => {
    const a = await assinaResposta(TEXTO);
    vi.stubEnv('GEMINI_API_KEY', 'outra-chave');
    expect(await assinaturaConfere(TEXTO, a)).toBe(false);
  });
});

describe('wavDePcm', () => {
  it('poe o cabecalho RIFF de 44 bytes na frente do PCM', () => {
    const pcm = new Uint8Array([1, 2, 3, 4]);
    const wav = wavDePcm(pcm, 24_000);
    const v = new DataView(wav.buffer);
    const texto = (i: number, n: number) => String.fromCharCode(...wav.subarray(i, i + n));

    expect(wav.length).toBe(48);
    expect(texto(0, 4)).toBe('RIFF');
    expect(texto(8, 4)).toBe('WAVE');
    expect(v.getUint16(20, true)).toBe(1); // PCM
    expect(v.getUint16(22, true)).toBe(1); // mono
    expect(v.getUint32(24, true)).toBe(24_000);
    expect(v.getUint32(28, true)).toBe(48_000); // bytes por segundo
    expect(v.getUint16(34, true)).toBe(16);
    expect(v.getUint32(40, true)).toBe(4);
    expect(Array.from(wav.subarray(44))).toEqual([1, 2, 3, 4]);
  });
});

describe('taxaDoMime', () => {
  it('le a taxa do mimeType, e cai em 24 kHz sem ela', () => {
    expect(taxaDoMime('audio/L16;codec=pcm;rate=16000')).toBe(16_000);
    expect(taxaDoMime('audio/L16')).toBe(24_000);
    expect(taxaDoMime(undefined)).toBe(24_000);
  });
});

describe('fala', () => {
  it('pede ao modelo de voz, com a chave no cabecalho, e devolve WAV', async () => {
    geminiFala(new Uint8Array([9, 9]));

    const wav = await fala(TEXTO);
    const [url, opcoes] = pedido.mock.calls[0];
    const corpo = JSON.parse(String(opcoes?.body));

    expect(String(url)).toContain(`/models/${MODELO_DE_VOZ}:generateContent`);
    expect(String(url)).not.toContain(CHAVE);
    expect((opcoes?.headers as Record<string, string>)['x-goog-api-key']).toBe(CHAVE);
    expect(corpo.generationConfig.responseModalities).toEqual(['AUDIO']);
    expect(corpo.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe(VOZ);
    expect(corpo.contents[0].parts[0].text).toContain(TEXTO);
    expect(wav?.length).toBe(46);
    expect(String.fromCharCode(...(wav as Uint8Array).subarray(0, 4))).toBe('RIFF');
  });

  it('usa a taxa que o Gemini declarar', async () => {
    geminiFala(new Uint8Array([0, 0]), 'audio/L16;codec=pcm;rate=16000');
    const wav = (await fala(TEXTO)) as Uint8Array;
    expect(new DataView(wav.buffer).getUint32(24, true)).toBe(16_000);
  });

  it('sem chave nao sai nada para o Google', async () => {
    vi.stubEnv('GEMINI_API_KEY', '');
    expect(await fala(TEXTO)).toBeNull();
    expect(pedido).not.toHaveBeenCalled();
  });

  it('HTTP de erro e null, e o corpo do Google nao segue adiante', async () => {
    const erro = JSON.stringify({ error: { message: 'quota exceeded' } });
    pedido.mockImplementation(async () => new Response(erro, { status: 429 }));
    expect(await fala(TEXTO)).toBeNull();
    expect(JSON.stringify(captureMessage.mock.calls[0])).not.toContain('quota exceeded');
  });

  it('resposta sem audio e null', async () => {
    const soTexto = JSON.stringify({ candidates: [{ content: { parts: [{ text: 'x' }] } }] });
    pedido.mockImplementation(async () => new Response(soTexto));
    expect(await fala(TEXTO)).toBeNull();
  });

  it('desiste depois do prazo', async () => {
    vi.useFakeTimers();
    pedido.mockImplementation(
      (_url, opcoes) =>
        new Promise((_resolve, reject) => {
          opcoes?.signal?.addEventListener('abort', () =>
            reject(new DOMException('demorou', 'AbortError'))
          );
        })
    );

    const promessa = fala(TEXTO);
    await vi.advanceTimersByTimeAsync(ESPERA_DA_VOZ_MS + 1);

    expect(await promessa).toBeNull();
    expect(captureMessage.mock.calls[0]?.[1]).toMatchObject({ tags: { motivo: 'demora' } });
  });
});
