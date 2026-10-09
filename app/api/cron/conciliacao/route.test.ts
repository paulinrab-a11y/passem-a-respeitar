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

const { GET } = await import('./route');

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
    });
    expect(concilia).toHaveBeenCalledTimes(1);
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
