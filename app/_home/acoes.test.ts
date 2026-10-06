import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * O frete na ficha (#205): sem sessao, com limite por IP, e so para mostrar.
 */
vi.mock('@/lib/loja/catalogo', () => ({ opcoesDeFrete: vi.fn() }));

let cabecalhos = new Headers();
vi.mock('next/headers', () => ({ headers: async () => cabecalhos }));

const { opcoesDeFrete } = await import('@/lib/loja/catalogo');
const { cotarFreteNaFicha } = await import('./acoes');

const SEDEX = { servico: 'sedex', nome: 'SEDEX', precoCentavos: 1432, prazoDias: 2 } as const;

let n = 0;
const cotar = (extra: Record<string, unknown> = {}) =>
  cotarFreteNaFicha({ slug: 'camiseta-cbac', tamanho: 'M', cep: '01310-100', ...extra });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(opcoesDeFrete).mockResolvedValue({
    ok: true,
    subtotalCentavos: 12000,
    opcoes: [SEDEX],
  });
  // IP novo por caso: o limite guarda estado no modulo.
  n += 1;
  cabecalhos = new Headers({ 'x-forwarded-for': `198.51.100.${(n % 250) + 1}` });
  vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
  vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
});

afterEach(() => vi.unstubAllEnvs());

describe('cotarFreteNaFicha', () => {
  it('devolve as opcoes para uma camiseta, com o CEP so em digitos, sem pedir sessao', async () => {
    expect(await cotar()).toEqual({ ok: true, opcoes: [SEDEX] });
    expect(opcoesDeFrete).toHaveBeenCalledWith(
      [{ slug: 'camiseta-cbac', tamanho: 'M', quantidade: 1 }],
      '01310100'
    );
  });

  it('e sempre UMA camiseta, por mais que o navegador peca', async () => {
    await cotar({ quantidade: 50 });
    expect(vi.mocked(opcoesDeFrete).mock.calls[0][0][0].quantidade).toBe(1);
  });

  it.each(['0131010', '', 1310100, null])('CEP %j recusa sem consultar', async (cep) => {
    expect(await cotar({ cep })).toEqual({
      ok: false,
      texto: 'Confira o CEP: não encontrei esse endereço.',
    });
    expect(opcoesDeFrete).not.toHaveBeenCalled();
  });

  it('slug que nao passa no schema nao consulta', async () => {
    expect((await cotar({ slug: 'Camiseta Com Espaco' })).ok).toBe(false);
    expect(opcoesDeFrete).not.toHaveBeenCalled();
  });

  it('para depois de vinte consultas do mesmo IP em dez minutos', async () => {
    for (let i = 0; i < 20; i++) expect((await cotar()).ok).toBe(true);

    expect(await cotar()).toEqual({
      ok: false,
      texto: 'Muitas consultas de frete. Tente de novo em alguns minutos.',
    });
    expect(opcoesDeFrete).toHaveBeenCalledTimes(20);
  });

  it('o limite de um IP nao atinge outro', async () => {
    for (let i = 0; i < 21; i++) await cotar();
    cabecalhos = new Headers({ 'x-forwarded-for': '198.51.100.250' });
    expect((await cotar()).ok).toBe(true);
  });

  it.each([
    ['frete-fora-do-ar', 'Não consegui calcular o frete agora. Tente de novo em instantes.'],
    ['frete-sem-servico', 'Os Correios não entregam nesse CEP por PAC nem por SEDEX.'],
    ['frete-sem-configuracao', 'O frete está indisponível no momento. Tente de novo mais tarde.'],
  ] as const)('traduz %s sem contar o que falta', async (motivo, texto) => {
    vi.mocked(opcoesDeFrete).mockResolvedValue({ ok: false, motivo });
    expect(await cotar()).toEqual({ ok: false, texto });
  });
});
