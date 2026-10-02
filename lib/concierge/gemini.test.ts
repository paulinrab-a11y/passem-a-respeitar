import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ESPERA_MS, extraiTexto, MODELO, montaCorpo, pergunta, type Troca } from './gemini';
import { PROMPT_DO_CONCIERGE } from './prompt';

/**
 * A conversa com o Gemini (#191). O que se prova aqui:
 *
 *   - o corpo do POST tem a forma que a API pede, com o prompt como instrucao
 *     de sistema e os papeis traduzidos
 *   - a chave vai no cabecalho, nunca na URL
 *   - qualquer falha — chave ausente, HTTP de erro, resposta sem texto,
 *     demora, rede — vira `null`, e nada do erro original segue adiante
 */

const captureMessage = vi.fn();
vi.mock('@sentry/nextjs', () => ({
  captureMessage: (...a: unknown[]) => captureMessage(...a),
  flush: async () => true,
}));

// Inventada. A de verdade nunca entra num teste.
const CHAVE = 'chave-de-teste';

const pedido = vi.fn<typeof fetch>();

function respondeCom(corpo: unknown, status = 200) {
  pedido.mockImplementation(async () => new Response(JSON.stringify(corpo), { status }));
}

function respostaDoGemini(texto: string) {
  return { candidates: [{ content: { parts: [{ text: texto }] } }] };
}

function mandado() {
  const [url, opcoes] = pedido.mock.calls[0];
  return {
    url: String(url),
    metodo: opcoes?.method,
    cabecalhos: opcoes?.headers as Record<string, string>,
    corpo: JSON.parse(String(opcoes?.body)) as ReturnType<typeof montaCorpo>,
  };
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

describe('montaCorpo', () => {
  const historico: Troca[] = [
    { papel: 'usuario', texto: 'quando sai?' },
    { papel: 'concierge', texto: 'Dia 20 de novembro.' },
  ];

  it('poe o prompt como instrucao de sistema, nao como fala', () => {
    const corpo = montaCorpo([], 'oi');
    expect(corpo.systemInstruction.parts[0]?.text).toBe(PROMPT_DO_CONCIERGE);
    for (const c of corpo.contents) expect(c.parts[0]?.text).not.toBe(PROMPT_DO_CONCIERGE);
  });

  it('traduz os papeis e poe a pergunta nova por ultimo, como user', () => {
    const corpo = montaCorpo(historico, 'e a camiseta?');
    expect(corpo.contents).toEqual([
      { role: 'user', parts: [{ text: 'quando sai?' }] },
      { role: 'model', parts: [{ text: 'Dia 20 de novembro.' }] },
      { role: 'user', parts: [{ text: 'e a camiseta?' }] },
    ]);
  });

  it('limita o tamanho da resposta e desliga o pensamento, que comeria esse limite', () => {
    const config = montaCorpo([], 'oi').generationConfig;
    expect(config.maxOutputTokens).toBeLessThanOrEqual(400);
    expect(config.thinkingConfig.thinkingBudget).toBe(0);
  });
});

describe('extraiTexto', () => {
  it('junta as partes do primeiro candidato', () => {
    expect(
      extraiTexto({ candidates: [{ content: { parts: [{ text: 'a' }, { text: 'b' }] } }] })
    ).toBe('ab');
  });

  it.each([
    ['sem candidato', {}],
    ['candidato vazio', { candidates: [] }],
    ['sem partes', { candidates: [{ content: {} }] }],
    ['parte sem texto', { candidates: [{ content: { parts: [{}] } }] }],
    ['so espaco', { candidates: [{ content: { parts: [{ text: '  \n' }] } }] }],
  ])('%s e null, nao string vazia', (_nome, resposta) => {
    expect(extraiTexto(resposta)).toBeNull();
  });
});

describe('pergunta', () => {
  it('fala com o modelo certo, com a chave no cabecalho e fora da URL', async () => {
    respondeCom(respostaDoGemini('Dia 20 de novembro.'));

    const texto = await pergunta([], 'quando sai?');
    const m = mandado();

    expect(texto).toBe('Dia 20 de novembro.');
    expect(m.metodo).toBe('POST');
    expect(m.url).toContain(`/models/${MODELO}:generateContent`);
    expect(m.url).not.toContain(CHAVE);
    expect(m.cabecalhos['x-goog-api-key']).toBe(CHAVE);
    expect(m.corpo.contents.at(-1)).toEqual({ role: 'user', parts: [{ text: 'quando sai?' }] });
  });

  it('sem chave nao sai nada para o Google e a resposta e null', async () => {
    vi.stubEnv('GEMINI_API_KEY', '');

    expect(await pergunta([], 'oi')).toBeNull();
    expect(pedido).not.toHaveBeenCalled();
  });

  it('HTTP de erro e null, e o corpo do Google nao segue adiante', async () => {
    respondeCom({ error: { message: 'API key not valid' } }, 400);

    expect(await pergunta([], 'oi')).toBeNull();
    expect(captureMessage).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(captureMessage.mock.calls[0])).not.toContain('API key not valid');
  });

  it('resposta sem texto e null', async () => {
    respondeCom({ candidates: [{ finishReason: 'SAFETY' }] });
    expect(await pergunta([], 'oi')).toBeNull();
  });

  it('rede caida e null', async () => {
    pedido.mockRejectedValue(new TypeError('fetch failed'));
    expect(await pergunta([], 'oi')).toBeNull();
  });

  it('desiste depois do prazo e devolve null', async () => {
    vi.useFakeTimers();
    pedido.mockImplementation(
      (_url, opcoes) =>
        new Promise((_resolve, reject) => {
          opcoes?.signal?.addEventListener('abort', () =>
            reject(new DOMException('demorou', 'AbortError'))
          );
        })
    );

    const promessa = pergunta([], 'oi');
    await vi.advanceTimersByTimeAsync(ESPERA_MS + 1);

    expect(await promessa).toBeNull();
    expect(captureMessage.mock.calls[0]?.[1]).toMatchObject({ tags: { motivo: 'demora' } });
  });
});
