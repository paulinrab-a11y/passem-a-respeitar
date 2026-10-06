import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buscaEnderecoPeloCep } from './endereco-por-cep';

/**
 * Endereco pelo CEP (#204). O ViaCEP e um `fetch` dublado; o que se prova e
 * o que fazemos com a resposta, e que nenhuma falha vira erro: vira "sem
 * sugestao", e a pessoa digita.
 */

const pedido = vi.fn<typeof fetch>();

const PAULISTA = {
  cep: '01310-100',
  logradouro: 'Avenida Paulista',
  complemento: 'de 612 a 1510 - lado par',
  unidade: '',
  bairro: 'Bela Vista',
  localidade: 'São Paulo',
  uf: 'SP',
  estado: 'São Paulo',
  regiao: 'Sudeste',
  ibge: '3550308',
  gia: '1004',
  ddd: '11',
  siafi: '7107',
};

function responde(corpo: unknown, status = 200) {
  pedido.mockResolvedValue(new Response(JSON.stringify(corpo), { status }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', pedido);
  vi.stubEnv('VIACEP_URL', '');
  vi.stubEnv('VERCEL_ENV', '');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('o pedido ao ViaCEP', () => {
  it('vai para o endereco deles, com o CEP no caminho, e espera JSON', async () => {
    responde(PAULISTA);
    await buscaEnderecoPeloCep('01310100');

    const [url, opcoes] = pedido.mock.calls[0];
    const cabecalhos = (opcoes?.headers ?? {}) as Record<string, string>;
    expect(String(url)).toBe('https://viacep.com.br/ws/01310100/json/');
    expect(cabecalhos.Accept).toBe('application/json');
    expect(opcoes?.signal).toBeInstanceOf(AbortSignal);
  });

  it('o desvio da suite vale fora de producao, e e ignorado em producao', async () => {
    responde(PAULISTA);
    vi.stubEnv('VIACEP_URL', 'http://127.0.0.1:46331');
    await buscaEnderecoPeloCep('01310100');
    expect(String(pedido.mock.calls[0][0])).toBe('http://127.0.0.1:46331/ws/01310100/json/');

    vi.stubEnv('VERCEL_ENV', 'production');
    await buscaEnderecoPeloCep('01310100');
    expect(String(pedido.mock.calls[1][0])).toBe('https://viacep.com.br/ws/01310100/json/');
  });

  it.each(['0131010', '013101000', '01310-100', 'abcdefgh', ''])(
    'CEP %j nao sai daqui',
    async (cep) => {
      expect(await buscaEnderecoPeloCep(cep)).toEqual({ ok: false, motivo: 'cep-invalido' });
      expect(pedido).not.toHaveBeenCalled();
    }
  );
});

describe('a resposta', () => {
  it('vira rua, bairro, cidade e UF, e o resto fica de fora', async () => {
    responde(PAULISTA);

    expect(await buscaEnderecoPeloCep('01310100')).toEqual({
      ok: true,
      endereco: {
        logradouro: 'Avenida Paulista',
        bairro: 'Bela Vista',
        cidade: 'São Paulo',
        uf: 'SP',
      },
    });
  });

  it('CEP geral de cidade pequena vem sem rua e sem bairro, e isso nao e erro', async () => {
    responde({ cep: '69999-000', logradouro: '', bairro: '', localidade: 'Lábrea', uf: 'AM' });

    expect(await buscaEnderecoPeloCep('69999000')).toEqual({
      ok: true,
      endereco: { logradouro: '', bairro: '', cidade: 'Lábrea', uf: 'AM' },
    });
  });

  it('CEP que o ViaCEP nao conhece', async () => {
    responde({ erro: 'true' });
    expect(await buscaEnderecoPeloCep('99999999')).toEqual({
      ok: false,
      motivo: 'cep-desconhecido',
    });

    responde({ erro: true });
    expect(await buscaEnderecoPeloCep('99999999')).toEqual({
      ok: false,
      motivo: 'cep-desconhecido',
    });
  });

  it('UF em minuscula sobe; UF que nao existe e resposta torta', async () => {
    responde({ ...PAULISTA, uf: 'sp' });
    expect(await buscaEnderecoPeloCep('01310100')).toMatchObject({
      ok: true,
      endereco: { uf: 'SP' },
    });

    responde({ ...PAULISTA, uf: 'XX' });
    expect(await buscaEnderecoPeloCep('01310100')).toEqual({ ok: false, motivo: 'fora-do-ar' });
  });

  it('texto maior que o banco aceita e cortado no tamanho do campo', async () => {
    responde({ ...PAULISTA, logradouro: 'R'.repeat(200), bairro: 'B'.repeat(100) });

    const r = await buscaEnderecoPeloCep('01310100');
    expect(r.ok && r.endereco.logradouro.length).toBe(160);
    expect(r.ok && r.endereco.bairro.length).toBe(80);
  });
});

describe('falhas viram "sem sugestao"', () => {
  it('rede fora', async () => {
    pedido.mockRejectedValue(new Error('ECONNRESET'));
    expect(await buscaEnderecoPeloCep('01310100')).toEqual({ ok: false, motivo: 'fora-do-ar' });
  });

  it.each([429, 500, 503])('HTTP %i', async (status) => {
    responde({}, status);
    expect(await buscaEnderecoPeloCep('01310100')).toEqual({ ok: false, motivo: 'fora-do-ar' });
  });

  it('resposta que nao e JSON', async () => {
    pedido.mockResolvedValue(new Response('<html>oi</html>', { status: 200 }));
    expect(await buscaEnderecoPeloCep('01310100')).toEqual({ ok: false, motivo: 'fora-do-ar' });
  });

  it('resposta fora do formato', async () => {
    responde(['lista']);
    expect(await buscaEnderecoPeloCep('01310100')).toEqual({ ok: false, motivo: 'fora-do-ar' });
  });
});
