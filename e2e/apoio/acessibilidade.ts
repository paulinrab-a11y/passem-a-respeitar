import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';

/**
 * Verificacao automatica de acessibilidade (Issue #175).
 *
 * O axe le a pagina como um leitor de tela leria a estrutura dela: nomes,
 * papeis, contraste, ordem de cabecalho, `aria` apontando para o que existe.
 * Acha por volta de um terco dos problemas. O resto — ordem de leitura,
 * sentido do que e anunciado, uso por teclado — precisa de gente.
 */

type Achado = {
  regra: string;
  impacto: string;
  onde: string;
  /** So para contraste: o que foi medido. */
  medida?: string;
};

export type Laudo = {
  /** Esta errado. */
  violacoes: Achado[];
  /**
   * Contraste que ninguem conseguiu medir: texto em cima de imagem, de
   * gradiente ou de canvas, onde nao ha UMA cor de fundo. Nao e aprovacao nem
   * reprovacao — e "olhe voce".
   */
  contrasteSemMedida: Achado[];
  /**
   * O vermelho da identidade em texto pequeno. Fica abaixo do minimo por
   * pouco, e mudar a cor da marca nao e decisao de teste: ver
   * `VERMELHO_DA_IDENTIDADE`.
   */
  vermelhoDaIdentidade: string[];
};

/** WCAG 2.1, niveis A e AA. */
const REGRAS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/**
 * A unica violacao aceita, e so ela (#176).
 *
 * `--vermelho` (#e0161f) sobre o preto da 4,3 para 1; em texto pequeno a WCAG
 * pede 4,5. E a cor da marca.
 *
 * DECISAO DO DONO, em 29/09/2026: fica como esta. As alternativas eram um
 * segundo vermelho so para texto, um pouco mais claro, ou a mensagem de erro
 * em cinza com a barra vermelha ao lado. A marca fica com um vermelho so, e o
 * site fica 0,2 abaixo do minimo da WCAG AA nesses textos, sabendo disso.
 *
 * O teste nao reprova por isso, mas conta as ocorrencias, tela a tela — e so
 * aceita ESTA cor, com ESTA folga. Qualquer outro texto abaixo do minimo
 * reprova, e um texto vermelho a mais tambem.
 */
const VERMELHO_DA_IDENTIDADE = { cor: '#e0161f', minimo: 4 };

/**
 * Camadas de textura: linhas de varredura, vinheta, grao. Cobrem a tela
 * inteira, nao recebem clique e nao tem conteudo. Com elas na frente o axe
 * nao consegue dizer qual e o fundo de NENHUM texto, e o contraste da pagina
 * inteira sai como "sem medida". Saem de cena so durante a analise.
 *
 * O que se perde: a vinheta escurece as bordas da tela, entao texto perto da
 * borda tem, de verdade, um pouco menos de contraste do que o medido aqui.
 */
const TEXTURAS = '.auth-scan,.auth-vinheta,#grain,#scan,#vig';

/**
 * Espera as animacoes de entrada acabarem.
 *
 * Contraste medido no meio de um fade e contraste de um texto meio
 * transparente: reprovaria a pagina por um estado que dura um quinto de
 * segundo. Loop infinito nao entra na espera — ele nao acaba.
 */
async function paginaParada(page: Page) {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().iterations !== Number.POSITIVE_INFINITY)
        .map((a) => a.finished.catch(() => null))
    )
  );
}

type NaMao = { cor: string; fundo: string; razao: number; pede: number } | null;

/**
 * Contraste medido sem o axe, para o caso em que ele desiste.
 *
 * O axe desiste quando ha um pseudo-elemento por perto, e todo botao do site
 * tem um: o `::before` que preenche o botao de vermelho no carregamento. Em
 * repouso ele tem largura zero e nao muda cor nenhuma. Aqui a cor do texto e
 * comparada com o primeiro fundo solido subindo pela arvore.
 *
 * Devolve `null` quando nao ha o que comparar: fundo com imagem ou
 * gradiente, ou texto em cima de um canvas.
 */
function medeNaMao(page: Page, seletor: string): Promise<NaMao> {
  return page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;

    const rgba = (texto: string) => {
      const n = texto.match(/[\d.]+/g)?.map(Number) ?? [];
      return { r: n[0] ?? 0, g: n[1] ?? 0, b: n[2] ?? 0, a: n[3] ?? 1 };
    };
    const hex = (c: { r: number; g: number; b: number }) =>
      `#${[c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
    const luz = (c: { r: number; g: number; b: number }) => {
      const [r, g, b] = [c.r, c.g, c.b].map((v) => {
        const x = v / 255;
        return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };

    let fundo: { r: number; g: number; b: number } | null = null;
    let opacidade = 1;
    for (let e: Element | null = el; e; e = e.parentElement) {
      const estilo = getComputedStyle(e);
      opacidade *= Number(estilo.opacity);
      if (estilo.backgroundImage !== 'none') return null;
      const c = rgba(estilo.backgroundColor);
      if (c.a >= 0.99) {
        fundo = c;
        break;
      }
      if (c.a > 0) return null;
    }
    if (!fundo) return null;

    // Canvas atras do texto: a cor de fundo do CSS nao e o que se ve.
    const caixa = el.getBoundingClientRect();
    for (const canvas of document.querySelectorAll('canvas')) {
      const c = canvas.getBoundingClientRect();
      const visivel = getComputedStyle(canvas).display !== 'none' && c.width > 0 && c.height > 0;
      const cruza =
        c.left < caixa.right &&
        c.right > caixa.left &&
        c.top < caixa.bottom &&
        c.bottom > caixa.top;
      if (visivel && cruza) return null;
    }

    const estilo = getComputedStyle(el);
    // Texto so de contorno: a cor de preenchimento nao e o que se ve.
    if (Number.parseFloat(estilo.webkitTextStrokeWidth) > 0) return null;
    const texto = rgba(estilo.color);
    const a = texto.a * opacidade;
    const visto = {
      r: texto.r * a + fundo.r * (1 - a),
      g: texto.g * a + fundo.g * (1 - a),
      b: texto.b * a + fundo.b * (1 - a),
    };

    const [claro, escuro] = [luz(visto), luz(fundo)].sort((x, y) => y - x);
    const tamanho = Number.parseFloat(estilo.fontSize);
    const negrito = Number(estilo.fontWeight) >= 700;
    const grande = tamanho >= 24 || (negrito && tamanho >= 18.66);

    return {
      cor: hex(visto),
      fundo: hex(fundo),
      razao: Math.round(((claro + 0.05) / (escuro + 0.05)) * 100) / 100,
      pede: grande ? 3 : 4.5,
    };
  }, seletor);
}

const escrita = (m: { cor: string; fundo: string; razao: number; pede: number }) =>
  `${m.cor} sobre ${m.fundo}: ${m.razao} para 1, pede ${m.pede}`;

export async function laudo(page: Page, fora: string[] = []): Promise<Laudo> {
  // O ponteiro sai de cima de tudo: depois de um clique ele fica parado sobre
  // o botao, e o que se mediria e o botao em `:hover`.
  await page.mouse.move(0, 0);
  await paginaParada(page);
  await page.addStyleTag({ content: `${TEXTURAS}{display:none!important}` });

  let axe = new AxeBuilder({ page }).withTags(REGRAS);
  for (const seletor of fora) axe = axe.exclude(seletor);

  const { violations, incomplete } = await axe.analyze();

  const saida: Laudo = { violacoes: [], contrasteSemMedida: [], vermelhoDaIdentidade: [] };

  for (const v of violations) {
    for (const no of v.nodes) {
      const d = (no.any[0]?.data ?? {}) as Record<string, unknown>;
      const razao = Number(d.contrastRatio);

      if (
        v.id === 'color-contrast' &&
        d.fgColor === VERMELHO_DA_IDENTIDADE.cor &&
        razao >= VERMELHO_DA_IDENTIDADE.minimo
      ) {
        saida.vermelhoDaIdentidade.push(no.target.join(' '));
        continue;
      }

      saida.violacoes.push({
        regra: v.id,
        impacto: v.impact ?? 'desconhecido',
        onde: no.target.join(' '),
        medida: d.fgColor
          ? `${d.fgColor} sobre ${d.bgColor}: ${d.contrastRatio} para 1, pede ${d.expectedContrastRatio}`
          : undefined,
      });
    }
  }

  for (const v of incomplete.filter((i) => i.id === 'color-contrast')) {
    for (const no of v.nodes) {
      const onde = no.target.join(' ');
      // Alvo dentro de iframe ou de shadow DOM vem como lista; ai nao ha
      // seletor unico para reler.
      const m = no.target.length === 1 ? await medeNaMao(page, String(no.target[0])) : null;

      if (!m) {
        saida.contrasteSemMedida.push({ regra: v.id, impacto: 'sem medida', onde });
      } else if (m.razao < m.pede) {
        if (m.cor === VERMELHO_DA_IDENTIDADE.cor && m.razao >= VERMELHO_DA_IDENTIDADE.minimo) {
          saida.vermelhoDaIdentidade.push(onde);
        } else {
          saida.violacoes.push({
            regra: v.id,
            impacto: 'serious',
            onde,
            medida: `${escrita(m)} (medido sem o axe)`,
          });
        }
      }
    }
  }

  return saida;
}
