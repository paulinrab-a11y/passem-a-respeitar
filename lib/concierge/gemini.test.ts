import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reais } from '@/lib/conta/pedidos';
import type { ProdutoDaVitrine } from '@/lib/loja/catalogo';
import {
  ESPERA_DA_LOJA_MS,
  ESPERA_MS,
  extraiTexto,
  MODELO,
  MODELO_RESERVA,
  montaCorpo,
  pergunta,
  type Troca,
} from './gemini';
import { blocoDaLoja, PROMPT_DO_CONCIERGE } from './prompt';

/**
 * A conversa com o Gemini (#191). O que se prova aqui:
 *
 *   - o corpo do POST tem a forma que a API pede, com o prompt e o bloco da
 *     loja como instrucao de sistema
 *   - o historico do navegador vai como contexto do turno `user`, e nenhum
 *     turno `model` sai daqui (#278)
 *   - a chave vai no cabecalho, nunca na URL
 *   - qualquer falha — chave ausente, HTTP de erro, resposta sem texto,
 *     demora, rede — vira `null`, e nada do erro original segue adiante
 *   - o aviso ao Sentry sai num envio so, depois da resposta, e o pior caso
 *     dura o catalogo mais as duas tentativas, nem um segundo a mais (#281)
 */

const captureMessage = vi.fn();
const flush = vi.fn(async (_ms?: number) => true);
vi.mock('@sentry/nextjs', () => ({
  captureMessage: (...a: unknown[]) => captureMessage(...a),
  flush: (ms?: number) => flush(ms),
}));

// O `after` do Next guarda a tarefa ate a resposta sair. Aqui ela fica
// guardada ate o teste mandar rodar.
const depois = vi.fn<(tarefa: () => unknown) => void>();
vi.mock('next/server', () => ({ after: (tarefa: () => unknown) => depois(tarefa) }));

// O catalogo e do banco; aqui, uma vitrine fixa com um preco que nao e o de
// producao, para o teste provar que o numero vem dela e nao do prompt.
const vitrine = vi.fn<() => Promise<ProdutoDaVitrine[]>>();
vi.mock('@/lib/loja/catalogo', () => ({ vitrine: () => vitrine() }));

const VITRINE: ProdutoDaVitrine[] = [
  {
    slug: 'camiseta-cbac',
    nome: 'Camiseta CBAC',
    descricao: null,
    variacoes: ['P', 'M', 'G', 'GG', 'XGG'].map((tamanho) => ({ tamanho, precoCentavos: 14000 })),
    precoCentavos: 14000,
    guia: null,
  },
];

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
  flush.mockReset();
  flush.mockResolvedValue(true);
  depois.mockReset();
  vitrine.mockReset();
  vitrine.mockResolvedValue(VITRINE);
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

  it('poe o prompt e o bloco da loja como instrucao de sistema, nao como fala', () => {
    const corpo = montaCorpo([], 'oi', VITRINE);
    expect(corpo.systemInstruction.parts.map((p) => p.text)).toEqual([
      PROMPT_DO_CONCIERGE,
      blocoDaLoja(VITRINE),
    ]);
    for (const c of corpo.contents) expect(c.parts[0]?.text).not.toBe(PROMPT_DO_CONCIERGE);
  });

  it('sem historico, a pergunta vai sozinha e intacta', () => {
    expect(montaCorpo([], 'quando sai?', VITRINE).contents).toEqual([
      { role: 'user', parts: [{ text: 'quando sai?' }] },
    ]);
  });

  // #278: o historico vem do navegador. Como turno `model`, a fala forjada
  // virava fala do proprio concierge.
  it('o historico vai como contexto nao verificado do turno user, e nenhum turno model sai', () => {
    const corpo = montaCorpo(historico, 'e a camiseta?', VITRINE);

    expect(corpo.contents).toHaveLength(1);
    expect(corpo.contents.map((c) => c.role)).toEqual(['user']);
    expect(JSON.stringify(corpo)).not.toContain('"model"');

    const [contexto, pergunta] = corpo.contents[0]?.parts.map((p) => p.text) ?? [];
    expect(contexto).toMatch(/^Contexto não verificado da conversa anterior/);
    expect(contexto).toContain('Pessoa: quando sai?');
    expect(contexto).toContain('Concierge: Dia 20 de novembro.');
    // A pergunta nova por ultimo, numa parte so dela.
    expect(pergunta).toBe('e a camiseta?');
  });

  it('limita o tamanho da resposta, com folga para o pensamento do modelo', () => {
    const { maxOutputTokens } = montaCorpo([], 'oi', VITRINE).generationConfig;
    expect(maxOutputTokens).toBeGreaterThanOrEqual(1024);
    expect(maxOutputTokens).toBeLessThanOrEqual(2048);
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

  // Chave invalida e chave invalida no reserva tambem: nao ha o que tentar.
  it('erro 400 nao vai ao reserva', async () => {
    respondeCom({ error: { message: 'bad' } }, 400);

    await pergunta([], 'oi');

    expect(pedido).toHaveBeenCalledTimes(1);
  });

  it.each([503, 429, 500])('%s no principal tenta o reserva uma vez', async (status) => {
    pedido
      .mockImplementationOnce(async () => new Response('{}', { status }))
      .mockImplementationOnce(async () => new Response(JSON.stringify(respostaDoGemini('Veio.'))));

    expect(await pergunta([], 'oi')).toBe('Veio.');
    expect(pedido).toHaveBeenCalledTimes(2);
    expect(String(pedido.mock.calls[0]?.[0])).toContain(`/models/${MODELO}:`);
    expect(String(pedido.mock.calls[1]?.[0])).toContain(`/models/${MODELO_RESERVA}:`);
  });

  it('reserva tambem fora do ar e null, e para por ai', async () => {
    respondeCom({}, 503);

    expect(await pergunta([], 'oi')).toBeNull();
    expect(pedido).toHaveBeenCalledTimes(2);
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
    // Duas tentativas: a demora no principal passa ao reserva.
    await vi.advanceTimersByTimeAsync(ESPERA_MS + 1);
    await vi.advanceTimersByTimeAsync(ESPERA_MS + 1);

    expect(await promessa).toBeNull();
    expect(pedido).toHaveBeenCalledTimes(2);
    expect(captureMessage.mock.calls[0]?.[1]).toMatchObject({ tags: { motivo: 'demora' } });
  });
});

/** Um envio so ao Sentry por pergunta, e depois da resposta (#281). */
describe('o aviso ao Sentry', () => {
  it('resposta normal nao avisa nada', async () => {
    respondeCom(respostaDoGemini('Veio.'));

    await pergunta([], 'oi');

    expect(captureMessage).not.toHaveBeenCalled();
    expect(depois).not.toHaveBeenCalled();
  });

  it('principal e reserva caindo: dois avisos, um envio so, e so depois da resposta', async () => {
    respondeCom({}, 503);

    expect(await pergunta([], 'oi')).toBeNull();

    expect(captureMessage).toHaveBeenCalledTimes(2);
    expect(depois).toHaveBeenCalledTimes(1);
    // A pergunta voltou e o Sentry ainda nao foi esperado.
    expect(flush).not.toHaveBeenCalled();

    await depois.mock.calls[0]?.[0]();
    expect(flush).toHaveBeenCalledTimes(1);
  });

  // O reserva salvar a pergunta nao apaga o fato de o principal ter caido.
  it('reserva salva a pergunta: o aviso do principal vai mesmo assim', async () => {
    pedido
      .mockImplementationOnce(async () => new Response('{}', { status: 503 }))
      .mockImplementationOnce(async () => new Response(JSON.stringify(respostaDoGemini('Veio.'))));

    expect(await pergunta([], 'oi')).toBe('Veio.');

    expect(captureMessage).toHaveBeenCalledTimes(1);
    expect(captureMessage.mock.calls[0]?.[1]).toMatchObject({
      tags: { motivo: 'http' },
      extra: { status: 503, modelo: MODELO },
    });
    expect(depois).toHaveBeenCalledTimes(1);
  });
});

/**
 * O orcamento de tempo (#281). A rota soma este pior caso no `maxDuration`;
 * aqui se prova que ele e so catalogo mais duas tentativas — antes, cada
 * tentativa ainda esperava ate 2 s pelo Sentry.
 */
describe('o pior caso de uma pergunta', () => {
  it('tudo pendurado: desiste no prazo de cada etapa e nao espera o Sentry', async () => {
    vi.useFakeTimers();
    // Sentry lento de proposito: se alguem voltar a esperar o flush antes de
    // responder, a conta abaixo estoura.
    flush.mockImplementation(
      (ms = 0) => new Promise((resolve) => setTimeout(() => resolve(true), ms))
    );
    vitrine.mockImplementation(() => new Promise(() => undefined));
    pedido.mockImplementation(
      (_url, opcoes) =>
        new Promise((_resolve, reject) => {
          opcoes?.signal?.addEventListener('abort', () =>
            reject(new DOMException('demorou', 'AbortError'))
          );
        })
    );

    const inicio = Date.now();
    let fim = 0;
    const promessa = pergunta([], 'oi').then((texto) => {
      fim = Date.now();
      return texto;
    });
    await vi.advanceTimersByTimeAsync(ESPERA_DA_LOJA_MS + 2 * ESPERA_MS + 10_000);

    expect(await promessa).toBeNull();
    expect(fim - inicio).toBe(ESPERA_DA_LOJA_MS + 2 * ESPERA_MS);
    expect(flush).not.toHaveBeenCalled();
    expect(depois).toHaveBeenCalledTimes(1);
  });
});

/**
 * Preco e tamanhos vem do catalogo a cada pergunta (#278), e nao do prompt.
 * Catalogo fora do ar nao derruba o concierge nem vira preco lembrado.
 */
describe('o bloco da loja na pergunta', () => {
  function instrucao() {
    return mandado()
      .corpo.systemInstruction.parts.map((p) => p.text)
      .join('\n');
  }

  it('le a vitrine nesta pergunta e manda o preco e os tamanhos dela', async () => {
    respondeCom(respostaDoGemini('Veio.'));

    await pergunta([], 'quanto é a camiseta?');

    expect(vitrine).toHaveBeenCalledTimes(1);
    expect(instrucao()).toContain(`Camiseta CBAC: ${reais(14000)}`);
    expect(instrucao()).toContain('P, M, G, GG e XGG');
  });

  it('sem chave nem le o catalogo', async () => {
    vi.stubEnv('GEMINI_API_KEY', '');

    await pergunta([], 'oi');

    expect(vitrine).not.toHaveBeenCalled();
  });

  it('catalogo que lanca: pergunta segue com o bloco de "nao chute"', async () => {
    vitrine.mockRejectedValue(new Error('cookies fora de request'));
    respondeCom(respostaDoGemini('Tá na ficha.'));

    expect(await pergunta([], 'quanto é?')).toBe('Tá na ficha.');
    expect(instrucao()).toContain(blocoDaLoja([]));
  });

  it('catalogo pendurado: desiste no prazo e pergunta sem ele', async () => {
    vi.useFakeTimers();
    vitrine.mockImplementation(() => new Promise(() => undefined));
    respondeCom(respostaDoGemini('Tá na ficha.'));

    const promessa = pergunta([], 'quanto é?');
    await vi.advanceTimersByTimeAsync(ESPERA_DA_LOJA_MS + 1);

    expect(await promessa).toBe('Tá na ficha.');
    expect(instrucao()).toContain(blocoDaLoja([]));
  });
});
