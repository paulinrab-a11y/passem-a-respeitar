import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EntradaDaAssinatura, Veredito } from '@/lib/loja/assinatura-webhook';
import type { ResultadoDoWebhook } from '@/lib/loja/webhook';

/**
 * O codigo HTTP desta rota e uma instrucao para o Mercado Pago: ele reenvia
 * em nao-2xx (#45, #331). Um 200 no lugar de um 500 perde a notificacao para
 * sempre; um 500 no lugar de um 200 faz o provedor insistir no que nao muda.
 * A decisao de dinheiro mora em `processa()`, testada em lib/loja; aqui se
 * prova a traducao e o que chega ate ela.
 *
 * O limite por IP e o de verdade (na memoria): o que se quer provar e a
 * chave e a conta, e um duble de `limita` provaria so o duble.
 */
const processa =
  vi.fn<
    (
      corpo: unknown,
      recursoId: string | null,
      o: { assinada: boolean }
    ) => Promise<ResultadoDoWebhook>
  >();
const conferaAssinatura = vi.fn<(e: EntradaDaAssinatura) => Veredito>();

vi.mock('@/lib/loja/webhook', () => ({
  processa: (c: unknown, r: string | null, o: { assinada: boolean }) => processa(c, r, o),
}));
vi.mock('@/lib/loja/assinatura-webhook', () => ({
  conferaAssinatura: (e: EntradaDaAssinatura) => conferaAssinatura(e),
}));

type Recusa = { motivo: string; assinatura: string };
const avisaRecusa = vi.fn(async (_recusa: Recusa) => {});
vi.mock('@/lib/loja/aviso-de-recusa', () => ({
  avisaRecusa: (recusa: Recusa) => avisaRecusa(recusa),
}));

const { GET, POST } = await import('./route');

// IP proprio por caso: o limite guarda estado no modulo, e nenhum caso pode
// depender de quantas chamadas os anteriores gastaram.
let caso = 0;
let ip = '';

type Notificacao = { busca?: string; corpo?: string; cabecalhos?: Record<string, string> };

const notifica = ({ busca = '?data.id=123', corpo, cabecalhos = {} }: Notificacao = {}) =>
  POST(
    new NextRequest(`https://passem-a-respeitar.test/api/mercado-pago/webhook${busca}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip, ...cabecalhos },
      body: corpo ?? JSON.stringify({ type: 'payment', data: { id: '123' } }),
    })
  );

beforeEach(() => {
  vi.clearAllMocks();
  // Sem Redis: o limite cai na memoria, que e deterministica.
  vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
  vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
  caso += 1;
  ip = `198.51.100.${caso}`;
  processa.mockResolvedValue({ tipo: 'ignorado', motivo: 'ja-processado' });
  conferaAssinatura.mockReturnValue({ valida: true, origem: 'principal' });
  // O log da rota e esperado; aqui so atrapalharia a saida.
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('POST /api/mercado-pago/webhook: o resultado vira instrucao de reenvio', () => {
  it.each([
    [{ tipo: 'aplicado', estado: 'aprovado' }, 200],
    [{ tipo: 'ignorado', motivo: 'ja-processado' }, 200],
    [{ tipo: 'tente-de-novo', motivo: 'nao-consegui-confirmar' }, 500],
    [{ tipo: 'recusado', motivo: 'nao-assinado-fora-do-sandbox' }, 401],
  ] as const)('%o vira HTTP %i', async (resultado, status) => {
    processa.mockResolvedValue(resultado as ResultadoDoWebhook);

    const r = await notifica();

    expect(r.status).toBe(status);
  });

  // Nada do pagamento nem do motivo volta para quem chamou.
  it('a resposta nao carrega o motivo nem o estado', async () => {
    processa.mockResolvedValue({ tipo: 'tente-de-novo', motivo: 'nao-consegui-confirmar' });
    expect(await (await notifica()).json()).toEqual({ ok: false });

    processa.mockResolvedValue({ tipo: 'aplicado', estado: 'aprovado' });
    expect(await (await notifica()).json()).toEqual({ ok: true });
  });
});

describe('POST /api/mercado-pago/webhook: o que chega a processa()', () => {
  it('`data.id` da busca vira o recursoId', async () => {
    await notifica({ busca: '?data.id=abc&type=payment' });

    expect(processa).toHaveBeenCalledWith(expect.anything(), 'abc', { assinada: true });
    expect(conferaAssinatura).toHaveBeenCalledWith(expect.objectContaining({ recursoId: 'abc' }));
  });

  // Integracoes antigas mandam so `id`.
  it('`id` vale quando nao ha `data.id`', async () => {
    await notifica({ busca: '?id=velho&topic=payment' });

    expect(processa).toHaveBeenCalledWith(expect.anything(), 'velho', { assinada: true });
  });

  it('`data.id` ganha de `id` quando os dois vem', async () => {
    await notifica({ busca: '?id=velho&data.id=novo' });

    expect(processa).toHaveBeenCalledWith(expect.anything(), 'novo', { assinada: true });
  });

  it('sem nenhum dos dois, o recursoId e null', async () => {
    await notifica({ busca: '' });

    expect(processa).toHaveBeenCalledWith(expect.anything(), null, { assinada: true });
  });

  it('o corpo JSON chega inteiro', async () => {
    await notifica({ corpo: JSON.stringify({ action: 'order.processed', data: { id: '123' } }) });

    expect(processa).toHaveBeenCalledWith(
      { action: 'order.processed', data: { id: '123' } },
      '123',
      { assinada: true }
    );
  });

  // Corpo torto nao derruba a rota: quem decide com o que falta e processa().
  it('corpo que nao e JSON chega como null e nao vira 500', async () => {
    const r = await notifica({ corpo: 'isto nao e json' });

    expect(processa).toHaveBeenCalledWith(null, '123', { assinada: true });
    expect(r.status).toBe(200);
  });

  it('assinatura invalida chega como { assinada: false } e o motivo nao vaza', async () => {
    conferaAssinatura.mockReturnValue({ valida: false, motivo: 'nao-confere' });
    processa.mockResolvedValue({ tipo: 'recusado', motivo: 'nao-assinado-fora-do-sandbox' });

    const r = await notifica();

    expect(processa).toHaveBeenCalledWith(expect.anything(), '123', { assinada: false });
    expect(r.status).toBe(401);
    expect(JSON.stringify(await r.json())).not.toMatch(/nao-confere|sandbox/);
  });

  it('a assinatura e conferida com os cabecalhos do provedor e os dois segredos', async () => {
    vi.stubEnv('MERCADOPAGO_WEBHOOK_SECRET', 'segredo-de-teste');
    vi.stubEnv('MERCADOPAGO_WEBHOOK_SECRET_ALT', 'outro-segredo-de-teste');

    await notifica({ cabecalhos: { 'x-signature': 'ts=1,v1=abc', 'x-request-id': 'req-1' } });

    expect(conferaAssinatura).toHaveBeenCalledWith({
      assinatura: 'ts=1,v1=abc',
      requestId: 'req-1',
      recursoId: '123',
      segredos: { principal: 'segredo-de-teste', alternativo: 'outro-segredo-de-teste' },
    });
  });
});

describe('POST /api/mercado-pago/webhook: limite por IP', () => {
  it('a 61a chamada do mesmo IP no minuto e 429 com Retry-After e nao processa', async () => {
    for (let i = 0; i < 60; i++) {
      expect((await notifica()).status).toBe(200);
    }
    processa.mockClear();

    const r = await notifica();

    expect(r.status).toBe(429);
    expect(Number(r.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(processa).not.toHaveBeenCalled();
    expect(conferaAssinatura).toHaveBeenCalledTimes(60);
  });

  it('outro IP segue passando depois que um estourou', async () => {
    for (let i = 0; i < 61; i++) await notifica();

    ip = `203.0.113.${caso}`;
    expect((await notifica()).status).toBe(200);
  });
});

describe('GET /api/mercado-pago/webhook', () => {
  // O painel do provedor testa a URL antes de salvar a configuracao.
  it('responde 200', async () => {
    const r = await GET();

    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
  });
});

/**
 * O que a rota acrescenta ao `processa`: o aviso ao Sentry quando recusa
 * (#273). O orcamento contra rajada e testado em lib/loja/aviso-de-recusa.
 */
describe('POST /api/mercado-pago/webhook: recusa avisa o Sentry (#273)', () => {
  it('sem segredo configurado: aviso com o motivo da assinatura', async () => {
    conferaAssinatura.mockReturnValue({ valida: false, motivo: 'sem-segredo' });
    processa.mockResolvedValue({ tipo: 'recusado', motivo: 'nao-assinado-fora-do-sandbox' });

    const r = await notifica();

    expect(r.status).toBe(401);
    expect(avisaRecusa).toHaveBeenCalledWith({
      motivo: 'nao-assinado-fora-do-sandbox',
      assinatura: 'sem-segredo',
    });
  });

  it('assinatura que nao confere: aviso diz nao-confere, e nada do corpo vai junto', async () => {
    vi.stubEnv('MERCADOPAGO_WEBHOOK_SECRET', 'segredo-de-teste');
    conferaAssinatura.mockReturnValue({ valida: false, motivo: 'nao-confere' });
    processa.mockResolvedValue({ tipo: 'recusado', motivo: 'nao-assinado-fora-do-sandbox' });

    const r = await notifica({ busca: '?data.id=ORD123' });

    expect(r.status).toBe(401);
    expect(avisaRecusa).toHaveBeenCalledTimes(1);
    const [recusa] = avisaRecusa.mock.calls[0] ?? [];
    expect(recusa).toEqual({ motivo: 'nao-assinado-fora-do-sandbox', assinatura: 'nao-confere' });
    expect(JSON.stringify(recusa)).not.toContain('ORD123');
    expect(JSON.stringify(recusa)).not.toContain('segredo-de-teste');
  });

  it.each([
    [{ tipo: 'aplicado', estado: 'aprovado' }, 200],
    [{ tipo: 'ignorado', motivo: 'ja-processado' }, 200],
    [{ tipo: 'tente-de-novo', motivo: 'nao-consegui-confirmar' }, 500],
  ] as const)('%o nao avisa de recusa', async (resultado, status) => {
    processa.mockResolvedValue(resultado as ResultadoDoWebhook);

    const r = await notifica();

    expect(r.status).toBe(status);
    expect(avisaRecusa).not.toHaveBeenCalled();
  });
});
