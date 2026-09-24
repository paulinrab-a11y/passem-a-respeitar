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

function pede(authorization?: string) {
  return new Request('https://passem-a-respeitar.test/api/cron/conciliacao', {
    headers: authorization ? { authorization } : {},
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
