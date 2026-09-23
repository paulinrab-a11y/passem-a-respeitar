// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { alvoDoHash, levaAteAAncora } from './ancora';

/**
 * jsdom nao tem layout, entao nao tem `scrollIntoView`. O que da para provar
 * aqui e QUAL elemento seria rolado e QUANDO — a posicao final e medida no
 * navegador, com a secao de verdade, e esta anotada no PR.
 */
let rolou: ReturnType<typeof vi.fn<(opcoes?: boolean | ScrollIntoViewOptions) => void>>;

/**
 * Observador que sobra de um teste dispara no seguinte: o `montaHome` limpa a
 * classe da raiz, e limpar a classe E o evento que esta funcao espera. Por isso
 * todo `liga()` guarda o desligamento, e o afterEach chama todos.
 *
 * Nao e cerimonia de teste: e a mesma razao de a funcao devolver a limpeza, e
 * de o HomeRuntime chama-la ao desmontar.
 */
let desligar: Array<() => void> = [];

function liga() {
  const solta = levaAteAAncora(window);
  desligar.push(solta);
  return solta;
}

/** Monta a home em miniatura: as mesmas ancoras, na mesma ordem. */
function montaHome() {
  document.body.innerHTML = `
    <div id="intro"></div>
    <section id="hero"></section>
    <section id="clipe"></section>
    <section id="merch"></section>
    <section id="seção-com-acento"></section>
  `;
  document.documentElement.className = '';
}

function vaiPara(hash: string) {
  window.location.hash = hash;
}

/** Deixa o observador do jsdom entregar as mutacoes. */
const proximoTique = () => new Promise((pronto) => setTimeout(pronto, 0));

beforeEach(() => {
  desligar = [];
  rolou = vi.fn();
  Element.prototype.scrollIntoView = rolou;
  montaHome();
  vaiPara('');
});

afterEach(() => {
  for (const solta of desligar) solta();
  vi.restoreAllMocks();
});

describe('alvoDoHash', () => {
  it.each([
    ['sem hash', ''],
    ['so a cerquilha', '#'],
    ['id que nao existe', '#nao-existe'],
    ['texto que nem parece hash', 'merch'],
  ])('devolve null para %s', (_caso, hash) => {
    expect(alvoDoHash(document, hash)).toBeNull();
  });

  it('devolve null para null e undefined', () => {
    expect(alvoDoHash(document, null)).toBeNull();
    expect(alvoDoHash(document, undefined)).toBeNull();
  });

  // `#%` passa pelo navegador e derruba o decodeURIComponent. Sem o catch, o
  // efeito inteiro da home morre por causa de um endereco estranho.
  it('nao lanca com hash que o decodeURIComponent recusa', () => {
    expect(() => alvoDoHash(document, '#%')).not.toThrow();
    expect(alvoDoHash(document, '#%')).toBeNull();
  });

  it('acha o elemento do hash', () => {
    expect(alvoDoHash(document, '#merch')?.id).toBe('merch');
  });

  it('acha id acentuado, que chega percent-encoded', () => {
    expect(alvoDoHash(document, '#se%C3%A7%C3%A3o-com-acento')?.id).toBe('seção-com-acento');
  });
});

describe('levaAteAAncora', () => {
  it('nao faz nada sem hash', async () => {
    liga();
    await proximoTique();
    expect(rolou).not.toHaveBeenCalled();
  });

  it('nao faz nada com hash que nao casa com elemento nenhum', async () => {
    vaiPara('#nao-existe');
    document.documentElement.classList.add('locked');

    liga();
    document.documentElement.classList.remove('locked');
    await proximoTique();

    expect(rolou).not.toHaveBeenCalled();
  });

  // O caso do `booted` do legacy-site: script ja rodou nesta aba, nao ha intro.
  it('rola na hora quando nao ha trava', async () => {
    vaiPara('#merch');

    liga();

    expect(rolou).toHaveBeenCalledTimes(1);
    expect(rolou.mock.instances[0]).toBe(document.getElementById('merch'));
  });

  it('espera a trava sair antes de rolar', async () => {
    vaiPara('#merch');
    document.documentElement.classList.add('locked');

    liga();
    await proximoTique();

    // A intro ainda esta rodando: ninguem mexe na rolagem.
    expect(rolou).not.toHaveBeenCalled();

    document.documentElement.classList.remove('locked');
    await proximoTique();

    expect(rolou).toHaveBeenCalledTimes(1);
    expect(rolou.mock.instances[0]).toBe(document.getElementById('merch'));
  });

  it('rola sem animacao, que e o que prefers-reduced-motion pediria', async () => {
    vaiPara('#merch');

    liga();

    expect(rolou).toHaveBeenCalledWith({ block: 'start', behavior: 'auto' });
  });

  it('vai para a ancora pedida, nao para a primeira da pagina', async () => {
    vaiPara('#clipe');
    document.documentElement.classList.add('locked');

    liga();
    document.documentElement.classList.remove('locked');
    await proximoTique();

    expect(rolou.mock.instances[0]).toBe(document.getElementById('clipe'));
  });

  // A trava volta toda vez que a Loja ou a Sala abrem. Fechar a Loja nao pode
  // jogar a pessoa de volta para a ancora de meia hora atras.
  it('rola uma vez so, mesmo se a trava for e voltar', async () => {
    vaiPara('#merch');
    document.documentElement.classList.add('locked');

    liga();
    document.documentElement.classList.remove('locked');
    await proximoTique();

    document.documentElement.classList.add('locked');
    await proximoTique();
    document.documentElement.classList.remove('locked');
    await proximoTique();

    expect(rolou).toHaveBeenCalledTimes(1);
  });

  it('nao dispara com mudanca de classe que nao seja a trava', async () => {
    vaiPara('#merch');
    document.documentElement.classList.add('locked');

    liga();
    document.documentElement.classList.add('qualquer-outra');
    await proximoTique();

    expect(rolou).not.toHaveBeenCalled();
  });

  it('a funcao de limpeza desliga a espera', async () => {
    vaiPara('#merch');
    document.documentElement.classList.add('locked');

    const solta = liga();
    solta();

    document.documentElement.classList.remove('locked');
    await proximoTique();

    expect(rolou).not.toHaveBeenCalled();
  });

  it('a limpeza e segura mesmo quando nao havia o que observar', () => {
    vaiPara('');
    expect(() => levaAteAAncora(window)()).not.toThrow();
  });
});
