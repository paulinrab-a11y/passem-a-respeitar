import 'server-only';

import * as Sentry from '@sentry/nextjs';

/**
 * A voz do Concierge (Issue #193).
 *
 * Duas coisas moram aqui, e as duas existem para a cota de TTS nao virar um
 * servico de voz gratis para quem achar a rota:
 *
 *   - Assinatura. A rota do chat assina cada resposta que devolve; a rota da
 *     voz so fala texto que chega com a assinatura certa. Quem nao passou
 *     pelo Concierge nao tem o que mandar. A chave do HMAC deriva da propria
 *     `GEMINI_API_KEY`: nao e uma variavel a mais para configurar, e a
 *     assinatura some sozinha onde a voz nao funcionaria mesmo.
 *   - A chamada ao Gemini TTS, que devolve PCM cru. O cabecalho WAV e posto
 *     aqui para o navegador decodificar sem biblioteca.
 */

export const MODELO_DE_VOZ = 'gemini-2.5-flash-preview-tts';

/**
 * Voz pre-definida do Gemini. `Algenib` e a mais grave e rouca da lista; a
 * instrucao de estilo faz o resto. Trocar de voz e trocar este nome.
 */
export const VOZ = 'Algenib';

const ESTILO =
  'Leia o texto abaixo em português do Brasil como um rapper de São Paulo falando numa mensagem de voz: voz grave, seca, ritmo firme, sem pressa, sem entonação de locutor e sem animação. Só leia o texto, sem acrescentar nada.';

const URL_DA_VOZ = `https://generativelanguage.googleapis.com/v1beta/models/${MODELO_DE_VOZ}:generateContent`;

/** Por chamada: a fala de quatro frases leva uns segundos para ser gerada. */
export const ESPERA_DA_VOZ_MS = 20_000;

/** Quanto tempo uma resposta pode ser ouvida depois de chegar. */
const VALIDADE_S = 60 * 60;

/** O que o Gemini manda quando nao diz a taxa: PCM 16 bits, mono, 24 kHz. */
const TAXA_PADRAO = 24_000;

const enc = new TextEncoder();

function hex(buf: ArrayBuffer) {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function igualTempoConstante(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function chaveHmac(segredo: string) {
  return crypto.subtle.importKey(
    'raw',
    enc.encode(`concierge-voz:${segredo}`),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
}

async function assina(msg: string, segredo: string) {
  return hex(await crypto.subtle.sign('HMAC', await chaveHmac(segredo), enc.encode(msg)));
}

/**
 * `v1.<expiracao>.<hmac do texto>`, ou `null` sem chave configurada: sem
 * chave nao ha voz, e o painel nem mostra o botao.
 */
export async function assinaResposta(
  texto: string,
  agoraS = Math.floor(Date.now() / 1000)
): Promise<string | null> {
  const segredo = process.env.GEMINI_API_KEY;
  if (!segredo) return null;
  const exp = agoraS + VALIDADE_S;
  return `v1.${exp}.${await assina(`v1.${exp}.${texto}`, segredo)}`;
}

export async function assinaturaConfere(texto: string, assinatura: unknown): Promise<boolean> {
  const segredo = process.env.GEMINI_API_KEY;
  if (!segredo || typeof assinatura !== 'string') return false;

  const partes = assinatura.split('.');
  if (partes.length !== 3 || partes[0] !== 'v1') return false;

  const exp = Number(partes[1]);
  if (!Number.isFinite(exp) || exp * 1000 < Date.now()) return false;

  return igualTempoConstante(partes[2], await assina(`v1.${exp}.${texto}`, segredo));
}

/**
 * Cabecalho WAV (RIFF) na frente do PCM: 44 bytes, mono, 16 bits.
 * O navegador decodifica WAV em qualquer lugar; PCM cru em lugar nenhum.
 */
export function wavDePcm(pcm: Uint8Array, taxa = TAXA_PADRAO): Uint8Array<ArrayBuffer> {
  const canais = 1;
  const bits = 16;
  const bytesPorAmostra = (canais * bits) / 8;
  const saida = new Uint8Array(44 + pcm.length);
  const v = new DataView(saida.buffer);
  const texto = (pos: number, s: string) => {
    for (let i = 0; i < s.length; i++) saida[pos + i] = s.charCodeAt(i);
  };

  texto(0, 'RIFF');
  v.setUint32(4, 36 + pcm.length, true);
  texto(8, 'WAVE');
  texto(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, canais, true);
  v.setUint32(24, taxa, true);
  v.setUint32(28, taxa * bytesPorAmostra, true);
  v.setUint16(32, bytesPorAmostra, true);
  v.setUint16(34, bits, true);
  texto(36, 'data');
  v.setUint32(40, pcm.length, true);
  saida.set(pcm, 44);
  return saida;
}

/** `rate=24000` dentro do mimeType do Gemini, ou o padrao. */
export function taxaDoMime(mime: string | undefined): number {
  const m = /rate=(\d+)/.exec(mime ?? '');
  return m ? Number(m[1]) : TAXA_PADRAO;
}

type ParteDeAudio = { inlineData?: { mimeType?: string; data?: string } };
type RespostaDeVoz = { candidates?: { content?: { parts?: ParteDeAudio[] } }[] };

async function avisa(motivo: string, extra?: Record<string, unknown>) {
  console.error('[concierge-voz]', [motivo, extra?.status].filter(Boolean).join(':'));
  Sentry.captureMessage('concierge: nao consegui falar', {
    level: 'error',
    tags: { motivo },
    extra,
  });
  await Sentry.flush(2000);
}

/**
 * Fala o texto e devolve um WAV, ou `null` se nao deu. Mesma politica do
 * chat: toda falha e `null`, o detalhe fica no log e no Sentry.
 */
export async function fala(texto: string): Promise<Uint8Array<ArrayBuffer> | null> {
  const chave = process.env.GEMINI_API_KEY;
  if (!chave) {
    await avisa('sem-chave');
    return null;
  }

  const controle = new AbortController();
  const prazo = setTimeout(() => controle.abort(), ESPERA_DA_VOZ_MS);

  try {
    const r = await fetch(URL_DA_VOZ, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': chave },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `${ESTILO}\n\n${texto}` }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOZ } } },
        },
      }),
      signal: controle.signal,
      cache: 'no-store',
    });

    if (!r.ok) {
      await avisa('http', { status: r.status });
      return null;
    }

    const parte = ((await r.json()) as RespostaDeVoz).candidates?.[0]?.content?.parts?.find(
      (p) => p.inlineData?.data
    );
    if (!parte?.inlineData?.data) {
      await avisa('sem-audio');
      return null;
    }

    const pcm = Uint8Array.from(Buffer.from(parte.inlineData.data, 'base64'));
    return wavDePcm(pcm, taxaDoMime(parte.inlineData.mimeType));
  } catch (erro) {
    await avisa(erro instanceof Error && erro.name === 'AbortError' ? 'demora' : 'rede');
    return null;
  } finally {
    clearTimeout(prazo);
  }
}
