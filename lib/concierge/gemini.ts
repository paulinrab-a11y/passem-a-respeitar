import 'server-only';

import * as Sentry from '@sentry/nextjs';
import { PROMPT_DO_CONCIERGE } from './prompt';

/**
 * A conversa com o Gemini (Issue #191).
 *
 * REST direto, sem SDK: e um POST com JSON, e o SDK traria uma dependencia
 * nova para fazer o mesmo POST. A chave vai no cabecalho, nunca na URL —
 * URL vai para log de proxy e de CDN; cabecalho nao.
 *
 * O servidor nao guarda conversa nenhuma. O navegador manda as ultimas trocas
 * junto com a pergunta, e cada chamada daqui e inteira por si.
 *
 * Falha fechada e muda: chave ausente, Gemini fora do ar, demora ou resposta
 * torta viram o mesmo `{ ok: false }`. Quem transforma isso em frase para a
 * pessoa e a rota, e a frase nao conta o que aconteceu. O detalhe vai para o
 * Sentry, que e para quem precisa dele.
 */

export const MODELO = 'gemini-flash-latest';

/**
 * O reserva, so quando o principal responde 503 ou 429: o Flash gratuito
 * fica sobrecarregado com frequencia, e "saiu por um instante" nao pode ser
 * a resposta normal do site. O Lite e mais leve e raramente cai junto.
 */
export const MODELO_RESERVA = 'gemini-flash-lite-latest';

const urlDoModelo = (modelo: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`;

/** Por tentativa. Duas tentativas cabem no `maxDuration` da rota. */
export const ESPERA_MS = 12_000;

/** Status que valem uma segunda tentativa, no reserva. */
const PASSA_AO_RESERVA = new Set([429, 500, 503]);

/** O que o navegador manda: quem falou e o que foi dito. */
type Papel = 'usuario' | 'concierge';
export type Troca = { papel: Papel; texto: string };

type Parte = { text: string };
type Conteudo = { role: 'user' | 'model'; parts: Parte[] };

type CorpoDoPedido = {
  systemInstruction: { parts: Parte[] };
  contents: Conteudo[];
  generationConfig: { temperature: number; maxOutputTokens: number };
};

type RespostaDoGemini = {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
};

const PAPEL_NO_GEMINI: Record<Papel, Conteudo['role']> = {
  usuario: 'user',
  concierge: 'model',
};

/**
 * Monta o corpo do POST. Separado da chamada para o teste conferir a forma
 * sem falar com ninguem.
 *
 * `safetySettings` fica de fora de proposito: o padrao do Google e o que
 * vale, e relaxar isso nao e decisao de codigo.
 *
 * `maxOutputTokens` e folgado de proposito. O Flash "pensa" antes de
 * escrever, e os tokens do pensamento contam nesse limite: com 400, a
 * resposta chegava cortada no meio da frase. Desligar o pensamento
 * (`thinkingConfig`) nao e opcao: a versao atrás do alias recusa o pedido.
 * O tamanho do texto que a pessoa le quem segura e o prompt (quatro frases).
 */
export function montaCorpo(historico: Troca[], mensagem: string): CorpoDoPedido {
  return {
    systemInstruction: { parts: [{ text: PROMPT_DO_CONCIERGE }] },
    contents: [
      ...historico.map((t) => ({ role: PAPEL_NO_GEMINI[t.papel], parts: [{ text: t.texto }] })),
      { role: 'user', parts: [{ text: mensagem }] },
    ],
    generationConfig: { temperature: 0.6, maxOutputTokens: 1024 },
  };
}

/**
 * Tira o texto da resposta. Sem candidato, sem parte ou sem texto e falha,
 * nao string vazia: string vazia viraria uma bolha em branco no painel.
 */
export function extraiTexto(resposta: RespostaDoGemini): string | null {
  const partes = resposta.candidates?.[0]?.content?.parts ?? [];
  const texto = partes
    .map((p) => p.text ?? '')
    .join('')
    .trim();
  return texto.length > 0 ? texto : null;
}

let avisouChave = false;

/** O ultimo motivo de falha desta instancia, para o log da rota. */
export let ultimoMotivo = '';

async function avisa(motivo: string, extra?: Record<string, unknown>) {
  ultimoMotivo = [motivo, extra?.status, extra?.modelo].filter(Boolean).join(':');
  // Tambem no log da funcao: o Sentry pode estar desligado no preview.
  console.error('[concierge]', ultimoMotivo);
  Sentry.captureMessage('concierge: nao consegui responder', {
    level: 'error',
    tags: { motivo },
    extra,
  });
  // Funcao serverless congela assim que responde; sem isto o evento nao sai.
  await Sentry.flush(2000);
}

/**
 * Pergunta ao Gemini e devolve o texto, ou `null` se nao deu.
 *
 * A chave e lida a cada chamada, e nao no import: o teste troca o ambiente, e
 * uma rota que explode no import derruba a funcao inteira com 500 sem
 * mensagem. Sem chave, nada sai para o Google e a resposta e `null` — a
 * rota transforma em 502 e o resto do site segue.
 */
export async function pergunta(historico: Troca[], mensagem: string): Promise<string | null> {
  const chave = process.env.GEMINI_API_KEY;

  if (!chave) {
    // Uma vez por instancia: a falta da variavel e um aviso, nao um ataque.
    if (!avisouChave) {
      avisouChave = true;
      await avisa('sem-chave');
    }
    return null;
  }

  const corpo = JSON.stringify(montaCorpo(historico, mensagem));

  for (const modelo of [MODELO, MODELO_RESERVA]) {
    const resultado = await tenta(modelo, chave, corpo);
    if (resultado.texto !== null) return resultado.texto;
    if (!resultado.tentaOutro) return null;
  }
  return null;
}

type Tentativa = { texto: string | null; tentaOutro: boolean };

async function tenta(modelo: string, chave: string, corpo: string): Promise<Tentativa> {
  const controle = new AbortController();
  const prazo = setTimeout(() => controle.abort(), ESPERA_MS);

  try {
    const r = await fetch(urlDoModelo(modelo), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': chave,
      },
      body: corpo,
      signal: controle.signal,
      cache: 'no-store',
    });

    if (!r.ok) {
      // O status e nosso para saber; o corpo do Google nao vai adiante.
      await avisa('http', { status: r.status, modelo });
      return { texto: null, tentaOutro: PASSA_AO_RESERVA.has(r.status) };
    }

    const texto = extraiTexto((await r.json()) as RespostaDoGemini);
    if (texto === null) await avisa('sem-texto', { modelo });
    return { texto, tentaOutro: false };
  } catch (erro) {
    const motivo = erro instanceof Error && erro.name === 'AbortError' ? 'demora' : 'rede';
    await avisa(motivo, { modelo });
    // Demora no principal e o mesmo sintoma da sobrecarga.
    return { texto: null, tentaOutro: motivo === 'demora' };
  } finally {
    clearTimeout(prazo);
  }
}
