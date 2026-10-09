// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A loja e a sala da home (#49, #270): saida animada, fundo inerte enquanto
 * estao na tela e um modal por vez. O jsdom guarda o atributo `inert` sem
 * aplicar o efeito, e nao anima: a saida termina pelo `animationend` disparado
 * a mao ou pelo prazo, com relogio falso.
 *
 * O modulo guarda qual modal esta na tela; cada teste importa um novo, para
 * nao herdar o modal do teste anterior.
 */
type Modulo = typeof import('./modal-animado');
let modalAnimado: Modulo['modalAnimado'];

function montaHome() {
  document.body.innerHTML = `
    <header id="bar"><button type="button" id="som">som</button></header>
    <main>
      <a href="#loja" id="comprar">Comprar</a>
      <input id="cod" />
    </main>
    <div id="loja"><button type="button" id="fecharLoja">fechar</button></div>
    <div id="sala"><button type="button" id="fecharSala">fechar</button></div>
  `;
}

const el = (id: string) => document.getElementById(id) as HTMLElement;
const main = () => document.querySelector('main') as HTMLElement;
const fimDaSaida = (id: string) => el(id).dispatchEvent(new Event('animationend'));

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  ({ modalAnimado } = await import('./modal-animado'));
  montaHome();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('modalAnimado', () => {
  it('aberto, o resto e inerte; fechado, solta no fim da saida e devolve o foco', () => {
    const loja = modalAnimado(el('loja'));
    el('comprar').focus();
    loja.abre(el('comprar'));
    el('fecharLoja').focus();

    expect(main().hasAttribute('inert')).toBe(true);
    expect(el('bar').hasAttribute('inert')).toBe(true);
    expect(el('loja').hasAttribute('inert')).toBe(false);

    loja.fecha();
    // Saindo, o fundo continua preso: elemento inerte nao recebe o foco.
    expect(main().hasAttribute('inert')).toBe(true);

    fimDaSaida('loja');

    expect(el('loja').classList.contains('on')).toBe(false);
    expect(main().hasAttribute('inert')).toBe(false);
    expect(document.activeElement).toBe(el('comprar'));
  });

  it('sem animationend, o prazo fecha; com o foco no <body>, ele volta a quem abriu', () => {
    const loja = modalAnimado(el('loja'));
    loja.abre(el('comprar'));
    // Clique no fundo da loja: o foco sai do botao e vai para o <body>.
    (document.activeElement as HTMLElement | null)?.blur();

    loja.fecha();
    vi.advanceTimersByTime(400);

    expect(el('loja').classList.contains('on')).toBe(false);
    expect(document.activeElement).toBe(el('comprar'));
  });

  it('a sala que abre com a loja na tela fecha a loja e fica viva', () => {
    // A pessoa enviou o convite e, enquanto o servidor conferia, abriu a loja.
    const aoTerminarLoja = vi.fn();
    const loja = modalAnimado(el('loja'), aoTerminarLoja);
    const sala = modalAnimado(el('sala'));
    loja.abre(el('comprar'));
    el('fecharLoja').focus();

    sala.abre(el('cod'));
    el('fecharSala').focus();

    expect(el('loja').classList.contains('saindo')).toBe(true);
    expect(el('sala').classList.contains('on')).toBe(true);
    expect(el('sala').hasAttribute('inert')).toBe(false);
    expect(el('loja').hasAttribute('inert')).toBe(true);
    expect(document.activeElement).toBe(el('fecharSala'));

    fimDaSaida('loja');

    expect(el('loja').classList.contains('on')).toBe(false);
    expect(aoTerminarLoja).toHaveBeenCalledOnce();
    // A loja nao puxa o foco de volta para Comprar, que esta atras da sala.
    expect(document.activeElement).toBe(el('fecharSala'));
    expect(main().getAttribute('data-inerte-por')).toBe('sala');
    expect(el('sala').hasAttribute('inert')).toBe(false);

    sala.fecha();
    fimDaSaida('sala');

    expect(document.querySelectorAll('[inert]')).toHaveLength(0);
    expect(document.activeElement).toBe(el('cod'));
  });

  it('abrir o modal que ja esta na tela nao fecha ele mesmo', () => {
    const loja = modalAnimado(el('loja'));
    loja.abre(el('comprar'));
    loja.abre(el('comprar'));

    expect(el('loja').classList.contains('on')).toBe(true);
    expect(el('loja').classList.contains('saindo')).toBe(false);
  });
});
