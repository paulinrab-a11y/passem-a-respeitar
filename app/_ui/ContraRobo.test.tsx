// @vitest-environment jsdom

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Aviso } from './ContraRobo';

/**
 * A parte do navegador da protecao contra bot (#28).
 *
 * O widget de verdade e da Cloudflare e so existe num navegador com rede: quem
 * o exercita e a suite de ponta a ponta. Aqui ele e um duble que entrega o
 * que o teste mandar, e o que se prova e o que o NOSSO codigo faz com isso —
 * em especial o que a suite nao consegue ver, porque as chaves de teste
 * aceitam token repetido e nunca pedem a caixa: que cada resposta pede um
 * token novo, e o que acontece quando a Cloudflare quer que a pessoa clique.
 */

type Opcoes = {
  acao: string;
  aoMudar: (token: string) => void;
  aoFalhar: () => void;
  aoPedir: (pedindo: boolean) => void;
};

const montado: { opcoes: Opcoes; renova: ReturnType<typeof vi.fn>; desmonta: () => void }[] = [];
let chave = 'chave-publica-de-teste';

vi.mock('./desafio', () => ({
  get CHAVE_DO_DESAFIO() {
    return chave;
  },
  CAMPO_DO_DESAFIO: 'cf-turnstile-response',
  CAMPO_DA_ISCA: 'website',
  ESPERA_MS: 15000,
  montaDesafio: (_onde: HTMLElement, opcoes: Opcoes) => {
    const widget = { opcoes, renova: vi.fn(), desmonta: vi.fn() };
    montado.push(widget);
    return widget;
  },
}));

const { default: ContraRobo, SEM_AVISO } = await import('./ContraRobo');

const NAO_CARREGOU = /A verificação contra robôs não carregou/;
const CONFIRME = /Marque “Confirme que é humano” na caixa acima e envie de novo/;

const contado = vi.fn<(aviso: Aviso) => void>();
const enviado = vi.fn();

/**
 * O que a acao do formulario veria. O React so dispara a acao de um envio que
 * ninguem cancelou; o `onSubmit` ele chama sempre, e por isso o filtro.
 */
function aoEnviar(e: { defaultPrevented: boolean }) {
  if (!e.defaultPrevented) enviado();
}

/** O que o formulario sabe agora: o ultimo aviso, ou nenhum. */
const agora = () => contado.mock.calls.at(-1)?.[0] ?? SEM_AVISO;

function monta(tentativa = 0) {
  const arvore = (n: number) => (
    <form onSubmit={aoEnviar}>
      <ContraRobo acao="entrar" tentativa={n} aoMudar={contado} />
    </form>
  );
  const tela = render(arvore(tentativa));
  const form = tela.container.querySelector('form') as HTMLFormElement;
  const pedeEnvio = vi.spyOn(form, 'requestSubmit').mockImplementation(() => {});

  return {
    ...tela,
    form,
    pedeEnvio,
    token: () => form.querySelector<HTMLInputElement>('[name="cf-turnstile-response"]'),
    refaz: (n: number) => tela.rerender(arvore(n)),
  };
}

const chega = (token: string) => act(() => montado[0].opcoes.aoMudar(token));
const falha = () => act(() => montado[0].opcoes.aoFalhar());
const pede = (pedindo: boolean) => act(() => montado[0].opcoes.aoPedir(pedindo));
const passa = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

/** Envia, e diz se o envio passou ou foi segurado. */
function envia(form: HTMLFormElement) {
  let passou = false;
  act(() => {
    passou = fireEvent.submit(form);
  });
  return passou;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  montado.length = 0;
  chave = 'chave-publica-de-teste';
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('a isca', () => {
  it('vai no formulario, vazia, fora do teclado e fora do leitor de tela', () => {
    const { form } = monta();
    const isca = form.querySelector<HTMLInputElement>('[name="website"]');

    expect(isca?.value).toBe('');
    expect(isca?.tabIndex).toBe(-1);
    expect(isca?.autocomplete).toBe('off');
    expect(isca?.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it('existe mesmo sem chave: ela nao depende da Cloudflare', () => {
    chave = '';
    const { form, token } = monta();

    expect(form.querySelector('[name="website"]')).not.toBeNull();
    expect(token()).toBeNull();
    expect(montado).toHaveLength(0);
  });
});

describe('sem chave', () => {
  it('nenhum envio e segurado', () => {
    chave = '';
    const { form } = monta();

    expect(envia(form)).toBe(true);
    expect(contado).not.toHaveBeenCalled();
  });
});

describe('o token', () => {
  it('pede com a acao do formulario', () => {
    monta();
    expect(montado).toHaveLength(1);
    expect(montado[0].opcoes.acao).toBe('entrar');
  });

  it('vai no campo que o servidor le', () => {
    const { token } = monta();
    expect(token()?.value).toBe('');

    chega('token-1');
    expect(token()?.value).toBe('token-1');
  });

  it('que venceu sai do campo', () => {
    const { token } = monta();
    chega('token-1');
    chega('');
    expect(token()?.value).toBe('');
  });

  it('cada resposta do servidor pede um novo: o que foi junto esta gasto', () => {
    const { refaz } = monta(0);
    chega('token-1');
    expect(montado[0].renova).not.toHaveBeenCalled();

    refaz(1);
    expect(montado[0].renova).toHaveBeenCalledTimes(1);

    refaz(2);
    expect(montado[0].renova).toHaveBeenCalledTimes(2);
  });

  it('a mesma tentativa nao pede outro', () => {
    const { refaz } = monta(1);
    expect(montado[0].renova).toHaveBeenCalledTimes(1);

    refaz(1);
    expect(montado[0].renova).toHaveBeenCalledTimes(1);
  });

  it('o widget e desmontado junto com o formulario', () => {
    const { unmount } = monta();
    unmount();
    expect(montado[0].desmonta).toHaveBeenCalledTimes(1);
  });

  it('chegar sem ninguem esperando nao incomoda o formulario', () => {
    const { pedeEnvio } = monta();
    chega('token-1');

    expect(pedeEnvio).not.toHaveBeenCalled();
    expect(contado).not.toHaveBeenCalled();
  });
});

describe('envio com token', () => {
  it('passa direto', () => {
    const { form } = monta();
    chega('token-1');

    expect(envia(form)).toBe(true);
    expect(enviado).toHaveBeenCalledTimes(1);
    expect(contado).not.toHaveBeenCalled();
  });
});

describe('envio antes do token chegar', () => {
  it('e segurado, e o formulario fica sabendo', () => {
    const { form, pedeEnvio } = monta();

    expect(envia(form)).toBe(false);
    expect(agora()).toMatchObject({ esperando: true, aviso: null });
    expect(pedeEnvio).not.toHaveBeenCalled();
  });

  it('sai sozinho quando o token chega, ja com ele no campo', () => {
    const { form, pedeEnvio, token } = monta();
    envia(form);

    let noCampo: string | undefined;
    pedeEnvio.mockImplementation(() => {
      noCampo = token()?.value;
    });
    chega('token-1');

    expect(pedeEnvio).toHaveBeenCalledTimes(1);
    expect(noCampo).toBe('token-1');
    expect(agora()).toMatchObject({ esperando: false, aviso: null });
  });

  it('dois envios seguidos viram um so', () => {
    const { form, pedeEnvio } = monta();
    envia(form);
    envia(form);
    chega('token-1');

    expect(pedeEnvio).toHaveBeenCalledTimes(1);
    expect(contado.mock.calls.filter(([a]) => a.esperando)).toHaveLength(1);
  });

  it('desiste depois de quinze segundos, e diz por que', () => {
    const { form, pedeEnvio } = monta();
    envia(form);

    passa(14_999);
    expect(agora()).toMatchObject({ esperando: true, aviso: null });

    passa(1);
    expect(agora().esperando).toBe(false);
    expect(agora().aviso).toMatch(NAO_CARREGOU);
    expect(pedeEnvio).not.toHaveBeenCalled();
  });

  it('token que chega depois da desistencia nao ressuscita o envio', () => {
    const { form, pedeEnvio } = monta();
    envia(form);
    passa(15_000);

    chega('token-1');

    expect(pedeEnvio).not.toHaveBeenCalled();
    // Mas o aviso sai: agora ha token, e o proximo envio passa.
    expect(agora()).toMatchObject({ esperando: false, aviso: null });
    expect(envia(form)).toBe(true);
  });
});

describe('a Cloudflare pede que a pessoa marque a caixa', () => {
  it('sozinho, o pedido nao vira aviso: a caixa ja esta na tela', () => {
    monta();
    pede(true);
    expect(contado).not.toHaveBeenCalled();
  });

  it('envio sem marcar nao espera: diz o que falta', () => {
    const { form, pedeEnvio } = monta();
    pede(true);

    expect(envia(form)).toBe(false);
    expect(agora().esperando).toBe(false);
    expect(agora().aviso).toMatch(CONFIRME);

    // Nem depois de muito tempo: nao ha envio guardado.
    passa(60_000);
    chega('token-1');
    expect(pedeEnvio).not.toHaveBeenCalled();
    expect(agora().aviso).toBeNull();
  });

  it('quem insiste sem marcar le o aviso de novo', () => {
    const { form } = monta();
    pede(true);

    envia(form);
    const primeira = agora().vez;
    envia(form);

    expect(agora().aviso).toMatch(CONFIRME);
    expect(agora().vez).not.toBe(primeira);
  });

  it('pedido que chega com um envio esperando troca a espera pelo aviso', () => {
    const { form, pedeEnvio } = monta();
    envia(form);
    expect(agora().esperando).toBe(true);

    pede(true);
    expect(agora().esperando).toBe(false);
    expect(agora().aviso).toMatch(CONFIRME);

    // A espera acabou de verdade: nada de "nao carregou" quinze segundos
    // depois, e nada de envio sozinho quando a pessoa marcar.
    passa(15_000);
    expect(agora().aviso).toMatch(CONFIRME);
    chega('token-1');
    expect(pedeEnvio).not.toHaveBeenCalled();
  });

  it('depois de marcar, o aviso sai e o envio passa', () => {
    const { form } = monta();
    pede(true);
    envia(form);

    pede(false);
    chega('token-1');

    expect(agora()).toMatchObject({ esperando: false, aviso: null });
    expect(envia(form)).toBe(true);
    expect(enviado).toHaveBeenCalledTimes(1);
  });
});

describe('widget que nao carregou', () => {
  it('avisa, e diz o que fazer', () => {
    monta();
    falha();

    expect(agora().aviso).toMatch(NAO_CARREGOU);
    expect(agora().aviso).toContain('Desligue o bloqueador');
    expect(agora().aviso).toContain('recarregue a página');
  });

  it('nao segura o envio: quem responde e o servidor, recusando', () => {
    const { form } = monta();
    falha();

    expect(envia(form)).toBe(true);
    expect(agora().esperando).toBe(false);
  });

  it('solta quem estava esperando, sem enviar', () => {
    const { form, pedeEnvio } = monta();
    envia(form);
    falha();

    expect(agora().esperando).toBe(false);
    expect(pedeEnvio).not.toHaveBeenCalled();
  });

  it('se o widget se recupera, o aviso sai', () => {
    monta();
    falha();
    chega('token-1');

    expect(agora()).toMatchObject({ esperando: false, aviso: null });
  });
});

describe('o servidor respondeu', () => {
  it('o aviso daqui sai da frente: vale o que o servidor disse', () => {
    const { form, refaz } = monta(0);
    falha();
    expect(agora().aviso).toMatch(NAO_CARREGOU);

    // Widget que nao carregou nao segura o envio, e o servidor recusa.
    expect(envia(form)).toBe(true);
    refaz(1);

    expect(agora()).toMatchObject({ esperando: false, aviso: null });
  });

  it('sem aviso na tela, a resposta nao incomoda o formulario', () => {
    const { refaz } = monta(0);
    chega('token-1');

    refaz(1);

    expect(contado).not.toHaveBeenCalled();
  });

  it('o envio seguinte, ainda sem widget, continua indo ao servidor', () => {
    const { form, refaz } = monta(0);
    falha();
    refaz(1);

    expect(envia(form)).toBe(true);
    expect(enviado).toHaveBeenCalledTimes(1);
  });
});

describe('o que o formulario recebe', () => {
  it('cada aviso tem uma vez diferente: e a chave da mensagem na tela', () => {
    const { form } = monta();
    envia(form);
    falha();
    chega('token-1');

    const vezes = contado.mock.calls.map(([a]) => a.vez);
    expect(new Set(vezes).size).toBe(vezes.length);
  });

  it('o mesmo estado duas vezes nao e contado duas vezes', () => {
    monta();
    falha();
    falha();

    expect(contado).toHaveBeenCalledTimes(1);
  });
});
