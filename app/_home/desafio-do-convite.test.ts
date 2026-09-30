// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A protecao contra bot do campo de convite (#28). O widget e um duble, como
 * no teste do ContraRobo: o que se prova e a espera, e o que acontece quando a
 * Cloudflare pede que a pessoa marque a caixa — caminho que a suite de ponta a
 * ponta nao percorre, porque a chave de teste dela nunca pede.
 */

type Opcoes = {
  acao: string;
  discreto: boolean;
  aoMudar: (token: string) => void;
  aoFalhar: () => void;
  aoPedir: (pedindo: boolean) => void;
};

const montado: { opcoes: Opcoes; renova: ReturnType<typeof vi.fn>; desmonta: () => void }[] = [];
let chave = 'chave-publica-de-teste';

vi.mock('@/app/_ui/desafio', () => ({
  get CHAVE_DO_DESAFIO() {
    return chave;
  },
  ESPERA_MS: 15000,
  ESPERA_DA_PESSOA_MS: 120000,
  montaDesafio: (_onde: HTMLElement, opcoes: Opcoes) => {
    const widget = { opcoes, renova: vi.fn(), desmonta: vi.fn() };
    montado.push(widget);
    return widget;
  },
}));

const { desafioDoConvite } = await import('./desafio-do-convite');

const widget = () => montado.at(-1)?.opcoes as Opcoes;

function monta() {
  const humano = desafioDoConvite(document.createElement('div'));
  if (!humano) throw new Error('esperava a protecao ligada');
  return humano;
}

/** O que a promessa entregou, ou `undefined` se ela ainda espera. */
async function resposta(p: Promise<string>) {
  let valor: string | undefined;
  p.then((v) => {
    valor = v;
  });
  await vi.advanceTimersByTimeAsync(0);
  return valor;
}

beforeEach(() => {
  vi.useFakeTimers();
  montado.length = 0;
  chave = 'chave-publica-de-teste';
});

afterEach(() => {
  vi.useRealTimers();
});

describe('sem o que proteger', () => {
  it('sem chave nao ha protecao, e a home segue como antes', () => {
    chave = '';
    expect(desafioDoConvite(document.createElement('div'))).toBeNull();
  });

  it('sem o lugar do widget tambem nao', () => {
    expect(desafioDoConvite(null)).toBeNull();
  });
});

describe('preguicosa', () => {
  it('nao monta nada ate alguem chegar no campo', () => {
    monta();
    expect(montado).toHaveLength(0);
  });

  it('monta uma vez, discreta e com a acao do convite', () => {
    const humano = monta();
    humano.aquece();
    humano.aquece();
    humano.pede();

    expect(montado).toHaveLength(1);
    expect(widget()).toMatchObject({ acao: 'convite', discreto: true });
  });
});

describe('o token', () => {
  it('que ja chegou e entregue na hora', async () => {
    const humano = monta();
    humano.aquece();
    widget().aoMudar('token-1');

    expect(await resposta(humano.pede())).toBe('token-1');
  });

  it('que ainda nao chegou e esperado', async () => {
    const humano = monta();
    const pedido = humano.pede();
    expect(await resposta(pedido)).toBeUndefined();

    widget().aoMudar('token-1');
    expect(await resposta(pedido)).toBe('token-1');
  });

  it('que nao vem em quinze segundos vira vazio, e quem recusa e o servidor', async () => {
    const humano = monta();
    const pedido = humano.pede();

    await vi.advanceTimersByTimeAsync(14_999);
    expect(await resposta(pedido)).toBeUndefined();

    await vi.advanceTimersByTimeAsync(1);
    expect(await resposta(pedido)).toBe('');
  });

  it('gasto nao e entregue de novo', async () => {
    const humano = monta();
    humano.aquece();
    widget().aoMudar('token-1');
    await humano.pede();

    humano.renova();

    expect(montado[0].renova).toHaveBeenCalledTimes(1);
    expect(await resposta(humano.pede())).toBeUndefined();
  });
});

describe('a Cloudflare pede que a pessoa marque a caixa', () => {
  it('quem esperava fica sabendo, e ganha o tempo de uma pessoa', async () => {
    const humano = monta();
    const aoPedir = vi.fn();
    const pedido = humano.pede(aoPedir);

    widget().aoPedir(true);
    expect(aoPedir).toHaveBeenCalledTimes(1);

    // Os quinze segundos da maquina ja nao valem.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await resposta(pedido)).toBeUndefined();

    widget().aoMudar('token-1');
    expect(await resposta(pedido)).toBe('token-1');
  });

  it('quem chega com a caixa ja na tela fica sabendo na hora', async () => {
    const humano = monta();
    humano.aquece();
    widget().aoPedir(true);

    const aoPedir = vi.fn();
    const pedido = humano.pede(aoPedir);

    expect(aoPedir).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await resposta(pedido)).toBeUndefined();
  });

  it('a espera pela pessoa tambem tem fim', async () => {
    const humano = monta();
    const pedido = humano.pede();
    widget().aoPedir(true);

    await vi.advanceTimersByTimeAsync(120_000);
    expect(await resposta(pedido)).toBe('');
  });
});

describe('widget que nao carregou', () => {
  it('entrega vazio a quem esperava', async () => {
    const humano = monta();
    const pedido = humano.pede();

    widget().aoFalhar();

    expect(await resposta(pedido)).toBe('');
  });

  it('a tentativa seguinte comeca do zero: a rede pode ter voltado', async () => {
    const humano = monta();
    humano.pede();
    widget().aoFalhar();
    expect(montado[0].desmonta).toHaveBeenCalledTimes(1);

    const pedido = humano.pede();
    expect(montado).toHaveLength(2);

    widget().aoMudar('token-2');
    expect(await resposta(pedido)).toBe('token-2');
  });
});
