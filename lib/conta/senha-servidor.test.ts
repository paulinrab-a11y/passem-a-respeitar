import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { senhaVazada } from './senha-servidor';

/**
 * Senha distintiva de proposito: "password" nao serve para conferir que o
 * valor nao vaza, porque a propria URL do servico contem "password".
 */
const SENHA = 'zumbido-de-jabuticaba-42';

async function sha1(valor: string) {
  const bytes = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(valor));
  return Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

const prefixo = async () => (await sha1(SENHA)).slice(0, 5);
const sufixo = async () => (await sha1(SENHA)).slice(5);

const fetchFalso = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchFalso);
  fetchFalso.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function resposta(corpo: string, ok = true) {
  return { ok, text: async () => corpo };
}

describe('senhaVazada', () => {
  // O ponto do k-anonymity: a senha nao sai daqui, e nem o hash inteiro.
  it('manda so os 5 primeiros caracteres do hash', async () => {
    fetchFalso.mockResolvedValue(resposta(''));
    await senhaVazada(SENHA);

    const url: string = fetchFalso.mock.calls[0][0];
    expect(url).toBe(`https://api.pwnedpasswords.com/range/${await prefixo()}`);
  });

  it('nunca manda a senha nem o hash completo', async () => {
    fetchFalso.mockResolvedValue(resposta(''));
    await senhaVazada(SENHA);

    const [url, opcoes] = fetchFalso.mock.calls[0];
    const tudo = url + JSON.stringify(opcoes ?? {});

    expect(tudo).not.toContain(SENHA);
    expect(tudo).not.toContain(await sufixo());
    expect(opcoes.body).toBeUndefined();
  });

  it('pede padding, para o tamanho da resposta nao entregar nada', async () => {
    fetchFalso.mockResolvedValue(resposta(''));
    await senhaVazada(SENHA);

    expect(fetchFalso.mock.calls[0][1].headers['Add-Padding']).toBe('true');
  });

  it('acha a senha vazada na lista', async () => {
    fetchFalso.mockResolvedValue(
      resposta(`0018A45C4D1DEF81644B54AB7F969B88D65:1\n${await sufixo()}:10437277\n`)
    );

    expect(await senhaVazada(SENHA)).toBe(true);
  });

  it('deixa passar o que nao esta na lista', async () => {
    fetchFalso.mockResolvedValue(resposta('0018A45C4D1DEF81644B54AB7F969B88D65:1\n'));
    expect(await senhaVazada(SENHA)).toBe(false);
  });

  // O padding vem com contagem 0. Sem a checagem, todo mundo seria marcado
  // como vazado de vez em quando — e a pessoa nao conseguiria trocar a senha
  // por nada.
  it('ignora o padding, que vem com contagem zero', async () => {
    fetchFalso.mockResolvedValue(resposta(`${await sufixo()}:0\n`));
    expect(await senhaVazada(SENHA)).toBe(false);
  });

  it('nao se confunde com sufixo parecido', async () => {
    fetchFalso.mockResolvedValue(resposta(`${(await sufixo()).slice(0, -1)}9:500\n`));
    expect(await senhaVazada(SENHA)).toBe(false);
  });

  describe('falha aberta', () => {
    // O HIBP fora do ar nao pode impedir alguem de trocar a propria senha: seria
    // transformar indisponibilidade de terceiro em indisponibilidade nossa.
    it('deixa passar quando a rede cai', async () => {
      fetchFalso.mockRejectedValue(new Error('rede'));
      expect(await senhaVazada(SENHA)).toBe(false);
    });

    it('deixa passar no timeout', async () => {
      fetchFalso.mockRejectedValue(Object.assign(new Error('timeout'), { name: 'TimeoutError' }));
      expect(await senhaVazada(SENHA)).toBe(false);
    });

    it('deixa passar quando o servico devolve erro', async () => {
      fetchFalso.mockResolvedValue(resposta('', false));
      expect(await senhaVazada(SENHA)).toBe(false);
    });
  });

  it('tem prazo para responder', async () => {
    fetchFalso.mockResolvedValue(resposta(''));
    await senhaVazada(SENHA);

    expect(fetchFalso.mock.calls[0][1].signal).toBeDefined();
  });
});
