// @vitest-environment jsdom

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * O HomeRuntime quando o script da home NAO chega (#238).
 *
 * O que se prova aqui e o caminho de erro: chunk do three que nao baixa, init
 * que lanca. Nos dois a abertura fecha e a pagina segue — concierge montado,
 * ancora da URL honrada. 'Pular' antes de o chunk existir e o terceiro caso:
 * o clique nao fecha nada, fica anotado e vai para o script. O quarto e a
 * cena 3D que lanca com WebGL disponivel: o script a segura e a pagina segue,
 * mas o erro chega ao Sentry pelo `reporta` que o runtime entrega junto com
 * `humano` e `pulou`. O caminho feliz esta aqui so para mostrar que ele nao
 * mudou: a intro continua na tela, e quem a fecha e o script.
 *
 * Os imports dinamicos sao dubles. `three` e o unico que muda de teste para
 * teste (resolve, rejeita, demora), e como o Vitest guarda o modulo depois da
 * primeira avaliacao, cada teste limpa o registro e importa o HomeRuntime de
 * novo — por isso o import fica dentro do `monta`, e nao no topo. O mocker
 * guarda tambem o resultado da fabrica, e esse `vi.resetModules` nao limpa:
 * a fabrica do `three` e registrada de novo a cada teste, com `vi.doMock`.
 */
const duble = vi.hoisted(() => ({
  three: vi.fn<() => Promise<Record<string, unknown>>>(),
  initSite: vi.fn(),
  montaConcierge: vi.fn(),
  levaAteAAncora: vi.fn(),
  soltaAncora: vi.fn(),
  captureException: vi.fn(),
  registerPlugin: vi.fn(),
}));

vi.mock('three/examples/jsm/loaders/GLTFLoader.js', () => ({ GLTFLoader: class {} }));
vi.mock('gsap', () => ({ gsap: { registerPlugin: duble.registerPlugin } }));
vi.mock('gsap/ScrollTrigger', () => ({ ScrollTrigger: { nome: 'ScrollTrigger' } }));
vi.mock('./legacy-site', () => ({ default: duble.initSite }));
vi.mock('./concierge', () => ({ default: duble.montaConcierge }));
vi.mock('./desafio-do-convite', () => ({ desafioDoConvite: () => null }));
vi.mock('@/lib/ancora', () => ({ levaAteAAncora: duble.levaAteAAncora }));
vi.mock('@sentry/nextjs', () => ({ captureException: duble.captureException }));
// Espionado, nao substituido: o que interessa e quantas vezes e chamado, e o
// DOM precisa mudar de verdade para as asserções abaixo.
vi.mock('./abertura', { spy: true });

const CENA = { Scene: class {}, WebGLRenderer: class {} };

function montaHome() {
  document.documentElement.className = '';
  document.body.innerHTML = `
    <header id="bar"></header>
    <div id="intro"><button type="button" id="skip">pular</button></div>
    <main><section id="merch"></section></main>
  `;
}

const intro = () => document.getElementById('intro') as HTMLElement;
const bar = () => document.getElementById('bar') as HTMLElement;
const skip = () => document.getElementById('skip') as HTMLButtonElement;
const travada = () => document.documentElement.classList.contains('locked');

/** O que a abertura fechada parece: o mesmo estado de `fechaAbertura`. */
function esperaAberturaFechada() {
  expect(intro().classList.contains('out')).toBe(true);
  expect(intro().style.display).toBe('none');
  expect(travada()).toBe(false);
  expect(bar().classList.contains('on')).toBe(true);
}

function esperaAberturaNaTela() {
  expect(intro().classList.contains('out')).toBe(false);
  expect(intro().style.display).toBe('');
  expect(bar().classList.contains('on')).toBe(false);
}

async function monta() {
  const abertura = await import('./abertura');
  const fechaAbertura = vi.mocked(abertura.fechaAbertura);
  fechaAbertura.mockClear();
  const { default: HomeRuntime } = await import('./HomeRuntime');
  const tela = render(<HomeRuntime />);
  return { ...tela, fechaAbertura };
}

/** Deixa as promessas dos imports e do init andarem. */
const proximoTique = () => act(() => new Promise<void>((pronto) => setTimeout(pronto, 0)));

/**
 * O erro que chega ao Sentry e o do import. No navegador e o proprio
 * ChunkLoadError; aqui o mocker embrulha a rejeicao da fabrica num erro dele,
 * com o original em `cause`. Os dois contam.
 */
function erroReportado(): { erro: unknown; opcoes: unknown } {
  const [erro, opcoes] = duble.captureException.mock.calls[0] ?? [];
  const causa = erro instanceof Error && erro.cause !== undefined ? erro.cause : erro;
  return { erro: causa, opcoes };
}

beforeEach(() => {
  vi.resetModules();
  for (const fn of Object.values(duble)) fn.mockReset();
  duble.levaAteAAncora.mockReturnValue(duble.soltaAncora);
  vi.doMock('three', () => duble.three());
  montaHome();
});

afterEach(cleanup);

describe('quando tudo funciona', () => {
  it('o script recebe os globais e a configuracao, e a abertura fica para a intro', async () => {
    duble.three.mockResolvedValue(CENA);

    const { fechaAbertura } = await monta();
    await vi.waitFor(() => expect(duble.initSite).toHaveBeenCalledOnce());

    const w = window as unknown as Record<string, unknown>;
    expect(w.THREE).toMatchObject({ Scene: CENA.Scene, GLTFLoader: expect.any(Function) });
    expect(w.ScrollTrigger).toEqual({ nome: 'ScrollTrigger' });
    expect(duble.registerPlugin).toHaveBeenCalledWith({ nome: 'ScrollTrigger' });
    expect(duble.initSite.mock.calls[0]?.[1]).toEqual({
      humano: null,
      pulou: false,
      reporta: expect.any(Function),
    });

    // Quem fecha a abertura e a intro do script, nao o runtime.
    esperaAberturaNaTela();
    expect(fechaAbertura).not.toHaveBeenCalled();
    expect(duble.captureException).not.toHaveBeenCalled();
    expect(duble.montaConcierge).toHaveBeenCalledOnce();
    expect(duble.levaAteAAncora).toHaveBeenCalledWith(window);
  });

  it('desmontar solta a ancora', async () => {
    duble.three.mockResolvedValue(CENA);

    const { unmount } = await monta();
    await vi.waitFor(() => expect(duble.levaAteAAncora).toHaveBeenCalledOnce());
    unmount();

    expect(duble.soltaAncora).toHaveBeenCalledOnce();
  });
});

describe('quando o chunk do three nao chega', () => {
  it('a abertura fecha, o Sentry sabe, e concierge e ancora seguem', async () => {
    const semRede = new Error('Loading chunk 42 failed');
    duble.three.mockRejectedValue(semRede);

    await monta();
    await vi.waitFor(() => expect(duble.captureException).toHaveBeenCalledOnce());

    esperaAberturaFechada();
    expect(erroReportado()).toEqual({ erro: semRede, opcoes: { tags: { onde: 'home-init' } } });
    expect(duble.initSite).not.toHaveBeenCalled();
    expect(duble.montaConcierge).toHaveBeenCalledOnce();
    expect(duble.levaAteAAncora).toHaveBeenCalledWith(window);
  });

  it('depois de desmontar, nada acontece: nem fecha, nem avisa', async () => {
    let falha = (_erro: Error) => {};
    duble.three.mockReturnValue(
      new Promise<Record<string, unknown>>((_, rejeita) => {
        falha = rejeita;
      })
    );

    const { unmount, fechaAbertura } = await monta();
    unmount();
    falha(new Error('tarde demais'));
    await proximoTique();

    esperaAberturaNaTela();
    expect(fechaAbertura).not.toHaveBeenCalled();
    expect(duble.captureException).not.toHaveBeenCalled();
    expect(duble.montaConcierge).not.toHaveBeenCalled();
  });
});

describe('quando o init do script lanca', () => {
  it('a abertura fecha do mesmo jeito, e o erro vai para o Sentry', async () => {
    duble.three.mockResolvedValue(CENA);
    const semWebGL = new Error('Error creating WebGL context.');
    duble.initSite.mockImplementation(() => {
      throw semWebGL;
    });

    await monta();
    await vi.waitFor(() => expect(duble.captureException).toHaveBeenCalledOnce());

    esperaAberturaFechada();
    expect(erroReportado()).toEqual({ erro: semWebGL, opcoes: { tags: { onde: 'home-init' } } });
    expect(duble.initSite).toHaveBeenCalledOnce();
    expect(duble.montaConcierge).toHaveBeenCalledOnce();
    expect(duble.levaAteAAncora).toHaveBeenCalledWith(window);
  });
});

describe('quando a cena 3D lanca com WebGL disponivel', () => {
  it('o script reporta pelo runtime: Sentry com a tag home-cena, e a abertura fica para a intro', async () => {
    duble.three.mockResolvedValue(CENA);
    const bugDaCena = new TypeError("Cannot read properties of undefined (reading 'set')");
    duble.initSite.mockImplementation(
      (_config: unknown, extras: { reporta: (erro: unknown) => void }) => {
        // O que o catch do bloco GL faz quando `temWebGL()` responde que sim.
        extras.reporta(bugDaCena);
      }
    );

    const { fechaAbertura } = await monta();
    await vi.waitFor(() => expect(duble.captureException).toHaveBeenCalledOnce());

    expect(duble.captureException).toHaveBeenCalledWith(bugDaCena, {
      tags: { onde: 'home-cena' },
    });
    // O init terminou bem: so a cena faltou, o resto do script esta la, e e a
    // intro dele que fecha a abertura — nao o catch do runtime.
    esperaAberturaNaTela();
    expect(fechaAbertura).not.toHaveBeenCalled();
    expect(duble.montaConcierge).toHaveBeenCalledOnce();
    expect(duble.levaAteAAncora).toHaveBeenCalledWith(window);
  });
});

describe('pular antes de o chunk chegar', () => {
  it('o clique fica anotado e vai para o script, que pula a intro ao chegar', async () => {
    let chega = (_cena: Record<string, unknown>) => {};
    duble.three.mockReturnValue(
      new Promise<Record<string, unknown>>((resolve) => {
        chega = resolve;
      })
    );

    const { fechaAbertura } = await monta();
    fireEvent.click(skip());

    // O runtime nao fecha nada sozinho: com o script a caminho, a pagina
    // apareceria com os botoes mudos. Quem pula e a intro, quando existe.
    esperaAberturaNaTela();
    expect(fechaAbertura).not.toHaveBeenCalled();
    expect(duble.initSite).not.toHaveBeenCalled();

    chega(CENA);
    await vi.waitFor(() => expect(duble.initSite).toHaveBeenCalledOnce());

    expect(duble.initSite.mock.calls[0]?.[1]).toEqual({
      humano: null,
      pulou: true,
      reporta: expect.any(Function),
    });
    expect(duble.captureException).not.toHaveBeenCalled();
  });

  it('sem clique, o script sabe que ninguem pulou', async () => {
    duble.three.mockResolvedValue(CENA);

    await monta();
    await vi.waitFor(() => expect(duble.initSite).toHaveBeenCalledOnce());

    expect(duble.initSite.mock.calls[0]?.[1]).toMatchObject({ pulou: false });
  });

  it('se o chunk falha, o clique anotado nao muda nada: a abertura fecha do mesmo jeito', async () => {
    let falha = (_erro: Error) => {};
    duble.three.mockReturnValue(
      new Promise<Record<string, unknown>>((_, rejeita) => {
        falha = rejeita;
      })
    );

    const { fechaAbertura } = await monta();
    fireEvent.click(skip());
    esperaAberturaNaTela();

    falha(new Error('Loading chunk 42 failed'));
    await vi.waitFor(() => expect(duble.captureException).toHaveBeenCalledOnce());

    esperaAberturaFechada();
    expect(fechaAbertura).toHaveBeenCalledOnce();
  });
});
