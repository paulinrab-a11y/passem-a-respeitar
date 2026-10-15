import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A rota e fina: autoriza e delega. O que se testa aqui e a autorizacao, que
 * e a unica coisa que impede a rota de virar "faca N consultas ao provedor,
 * de graca, para quem pedir".
 */
const concilia = vi.fn(async () => ({
  olhados: 3,
  mudados: 1,
  semAvanco: 2,
  repetidos: 0,
  falhas: 0,
}));

vi.mock('@/lib/loja/conciliacao', () => ({ concilia: () => concilia() }));

const expiraVencidos = vi.fn(async () => ({ olhados: 2, expirados: 1, pagos: 0, adiados: 1 }));

vi.mock('@/lib/loja/expiracao', () => ({ expiraVencidos: () => expiraVencidos() }));

const captureCheckIn = vi.fn(
  (_checkIn: Record<string, unknown>, _config?: unknown) => 'id-do-check-in'
);
vi.mock('@sentry/nextjs', () => ({
  captureCheckIn: (checkIn: Record<string, unknown>, config?: unknown) =>
    captureCheckIn(checkIn, config),
}));

const enviaDepois = vi.fn();
vi.mock('@/lib/sentry/depois', () => ({ enviaDepois: () => enviaDepois() }));

const { GET } = await import('./route');
const { MONITOR } = await import('@/lib/sentry/monitor-da-conciliacao');

const SEGREDO = 'segredo-do-cron-de-teste-com-tamanho-razoavel';

let ultimoIp = 0;

/**
 * Cada pedido sai de um IP proprio: o limite da rota (10/min por IP) e outro
 * assunto, e com todos no mesmo balde o 11o caso deste arquivo viraria 429.
 */
function pede(authorization?: string) {
  ultimoIp += 1;
  const headers: Record<string, string> = { 'x-forwarded-for': `203.0.113.${ultimoIp}` };
  if (authorization) headers.authorization = authorization;

  return new Request('https://passem-a-respeitar.test/api/cron/conciliacao', {
    headers,
  }) as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = SEGREDO;
});

afterEach(() => {
  delete process.env.CRON_SECRET;
});

describe('autorizacao', () => {
  it('com o segredo certo, roda e devolve o balanco', async () => {
    const r = await GET(pede(`Bearer ${SEGREDO}`));

    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({
      ok: true,
      olhados: 3,
      mudados: 1,
      semAvanco: 2,
      repetidos: 0,
      falhas: 0,
      expiracao: { olhados: 2, expirados: 1, pagos: 0, adiados: 1 },
    });
    expect(concilia).toHaveBeenCalledTimes(1);
    expect(expiraVencidos).toHaveBeenCalledTimes(1);
  });

  // Pix pago que so a conciliacao descobriu vira `pago` antes de a expiracao
  // olhar o prazo do pedido (#298).
  it('expira depois de conciliar, nunca antes', async () => {
    const ordem: string[] = [];
    concilia.mockImplementationOnce(async () => {
      ordem.push('concilia');
      return { olhados: 0, mudados: 0, semAvanco: 0, repetidos: 0, falhas: 0 };
    });
    expiraVencidos.mockImplementationOnce(async () => {
      ordem.push('expira');
      return { olhados: 0, expirados: 0, pagos: 0, adiados: 0 };
    });

    await GET(pede(`Bearer ${SEGREDO}`));

    expect(ordem).toEqual(['concilia', 'expira']);
  });

  it.each([
    ['sem cabecalho', undefined],
    ['segredo errado', 'Bearer outro-segredo-qualquer-do-mesmo-tamanho-xx'],
    ['sem o Bearer', SEGREDO],
    ['prefixo certo, resto errado', `Bearer ${SEGREDO}x`],
  ])('%s: 401 e nao concilia', async (_caso, authorization) => {
    const r = await GET(pede(authorization));

    expect(r.status).toBe(401);
    expect(concilia).not.toHaveBeenCalled();
    expect(expiraVencidos).not.toHaveBeenCalled();
    // Quem chuta o segredo nao mexe no monitor (#273).
    expect(captureCheckIn).not.toHaveBeenCalled();
  });

  // O timingSafeEqual compara bytes e lanca com tamanhos diferentes. Contar
  // caracteres deixava passar um 'é' (1 caractere, 2 bytes) e a rota dava 500
  // so no tamanho exato do segredo: um oraculo do tamanho do CRON_SECRET (#287).
  it.each([
    ['mesmo numero de caracteres, um byte a mais', `Bearer ${'x'.repeat(SEGREDO.length - 1)}é`],
    ['mesmo numero de bytes, um caractere a menos', `Bearer ${'x'.repeat(SEGREDO.length - 2)}é`],
  ])('%s: 401, sem excecao, e nao concilia', async (_caso, authorization) => {
    const r = await GET(pede(authorization));

    expect(r.status).toBe(401);
    expect(concilia).not.toHaveBeenCalled();
  });

  // A alternativa — "deixa rodar enquanto nao configurou" — e uma rota
  // publica que faz N consultas ao provedor por chamada.
  it('sem CRON_SECRET cadastrado, nada passa, nem o cabecalho "certo"', async () => {
    delete process.env.CRON_SECRET;

    const r = await GET(pede(`Bearer ${SEGREDO}`));

    expect(r.status).toBe(401);
    expect(concilia).not.toHaveBeenCalled();
  });

  it('a resposta nao conta se o segredo existe ou so esta errado', async () => {
    const semSegredo = await GET(pede('Bearer x'));
    delete process.env.CRON_SECRET;
    const naoConfigurado = await GET(pede('Bearer x'));

    expect(await semSegredo.json()).toEqual(await naoConfigurado.json());
  });
});

describe('monitor do Sentry (#273)', () => {
  const statusDosCheckIns = () => captureCheckIn.mock.calls.map(([c]) => c.status);

  it('rodada limpa: in_progress e depois ok, com o mesmo id', async () => {
    const r = await GET(pede(`Bearer ${SEGREDO}`));

    expect(r.status).toBe(200);
    expect(statusDosCheckIns()).toEqual(['in_progress', 'ok']);
    expect(captureCheckIn.mock.calls[1]?.[0]).toMatchObject({
      monitorSlug: MONITOR.slug,
      checkInId: 'id-do-check-in',
    });
    expect(captureCheckIn.mock.calls[0]?.[1]).toEqual(MONITOR.config);
    expect(enviaDepois).toHaveBeenCalledTimes(1);
  });

  it('com falhas na conciliacao: check-in error, resposta continua 200 com o balanco', async () => {
    concilia.mockResolvedValueOnce({
      olhados: 4,
      mudados: 1,
      semAvanco: 0,
      repetidos: 0,
      falhas: 3,
    });

    const r = await GET(pede(`Bearer ${SEGREDO}`));

    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ falhas: 3 });
    expect(statusDosCheckIns()).toEqual(['in_progress', 'error']);
  });

  // Banco fora: o supabase-js devolve `{ error }`, e e `concilia` (provado em
  // conciliacao.test.ts) que transforma isso nesta excecao.
  it('banco fora na conciliacao: check-in error, nao expira, e a excecao segue (vira 500)', async () => {
    concilia.mockRejectedValueOnce(new Error('conciliacao: a varredura nao leu o banco'));

    await expect(GET(pede(`Bearer ${SEGREDO}`))).rejects.toThrow('a varredura nao leu o banco');
    expect(expiraVencidos).not.toHaveBeenCalled();
    expect(statusDosCheckIns()).toEqual(['in_progress', 'error']);
    expect(enviaDepois).toHaveBeenCalledTimes(1);
  });

  it('banco fora na expiracao: check-in error e a excecao segue (vira 500)', async () => {
    expiraVencidos.mockRejectedValueOnce(new Error('expiracao: a varredura nao leu o banco'));

    await expect(GET(pede(`Bearer ${SEGREDO}`))).rejects.toThrow('a varredura nao leu o banco');
    expect(statusDosCheckIns()).toEqual(['in_progress', 'error']);
    expect(enviaDepois).toHaveBeenCalledTimes(1);
  });

  it('o agendamento do monitor e o mesmo do vercel.json, com margem de uma hora', async () => {
    const { readFile } = await import('node:fs/promises');
    const vercel = JSON.parse(
      await readFile(new URL('../../../../vercel.json', import.meta.url), 'utf8')
    );
    const cron = vercel.crons.find((c: { path: string }) => c.path === '/api/cron/conciliacao');

    expect(MONITOR.config.schedule).toEqual({ type: 'crontab', value: cron.schedule });
    // Plano Hobby: o cron diario dispara em qualquer minuto da hora marcada.
    expect(MONITOR.config.checkinMargin).toBeGreaterThanOrEqual(60);
  });
});
