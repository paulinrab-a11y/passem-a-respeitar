import { readdirSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Loading em toda acao assincrona (#50). Invariantes lidas do codigo:
 *
 *   - rotulo que muda com a acao usa `Rotulo`, para o botao nao mudar de largura
 *   - todo botao com `Rotulo` tambem recebe a classe `carregando`
 *   - a classe `carregando` tem estilo para todo tipo de botao que a recebe
 */
function tsx(raiz: string): string[] {
  return readdirSync(raiz, { withFileTypes: true }).flatMap((item) => {
    const caminho = join(raiz, item.name);
    if (item.isDirectory()) return tsx(caminho);
    return item.name.endsWith('.tsx') && !item.name.endsWith('.test.tsx') ? [caminho] : [];
  });
}

const FONTES = tsx('app').map((caminho) => ({
  caminho: caminho.split(sep).join('/'),
  texto: readFileSync(caminho, 'utf8'),
}));
const CSS = readFileSync('app/globals.css', 'utf8');

describe('rotulo de acao', () => {
  it('nenhum botao troca o texto por ternario: isso muda a largura', () => {
    // O padrao antigo: {pendente ? 'Salvando…' : 'Salvar'}
    const quem = FONTES.filter((f) => /\?\s*['`][^'`\n]*…['`]\s*:/.test(f.texto)).map(
      (f) => f.caminho
    );

    expect(quem).toEqual([]);
  });

  it('acha os botoes com Rotulo', () => {
    const total = FONTES.reduce((n, f) => n + (f.texto.match(/<Rotulo\b/g) ?? []).length, 0);

    expect(total).toBeGreaterThanOrEqual(15);
  });

  const usos = FONTES.flatMap((f) =>
    [...f.texto.matchAll(/<Rotulo\b/g)].map((m) => {
      const ate = f.texto.slice(0, m.index);
      const botao = ate.slice(ate.lastIndexOf('<button'));
      const linha = ate.split('\n').length;
      return [`${f.caminho}:${linha}`, botao] as const;
    })
  );

  it.each(usos)('%s: o botao tambem recebe `carregando`', (_onde, botao) => {
    expect(botao).toContain('carregando');
  });

  it.each(usos)('%s: o botao fica desabilitado durante a acao', (_onde, botao) => {
    expect(botao).toMatch(/disabled=\{/);
  });
});

describe('estilo de carregando', () => {
  it('vale para todo .btn, e nao so para o de enviar formulario', () => {
    expect(CSS).toMatch(/(?:^|\n)\.btn\.carregando\{[^}]*cursor:progress/);
    expect(CSS).toMatch(/(?:^|\n)\.btn\.carregando::before\{[^}]*transform:none/);
    expect(CSS).not.toContain('.auth-enviar.carregando');
  });

  it('tira o fundo do botao cheio, senao a barra enche por tras dele', () => {
    expect(CSS).toMatch(/(?:^|\n)\.btn\.carregando\{[^}]*background:none/);
  });

  it('o botao de perigo desabilitado nao esconde a barra quando esta carregando', () => {
    expect(CSS).toContain('.btn.perigo.carregando:disabled::before{display:block}');
  });

  it('botao de texto e item do menu tambem tem indicador', () => {
    expect(CSS).toMatch(
      /\.auth-link\.carregando::after,\.menu-conta-in \.sair\.carregando::after\{[^}]*animation:link-carrega /
    );
  });

  it('os indicadores so animam transform', () => {
    expect(CSS).toContain(
      '@keyframes link-carrega{from{transform:scaleX(0)}to{transform:scaleX(1)}}'
    );
    expect(CSS).toContain(
      '@keyframes rota-progresso{from{transform:scaleX(0)}to{transform:scaleX(.9)}}'
    );
  });

  it('nenhum indicador de carregamento e loop', () => {
    const regras = [...CSS.matchAll(/[^{}\n]*(?:carregando|barra-rota)[^{}\n]*\{[^}]*\}/g)].map(
      (m) => m[0]
    );

    expect(regras.length).toBeGreaterThan(5);
    // O brilho do player e do esqueleto e da #46 e para com movimento reduzido.
    expect(regras.filter((r) => r.includes('infinite') && !r.includes('esq-brilho'))).toEqual([]);
  });
});

describe('largura do rotulo', () => {
  it('os dois textos ocupam a mesma celula', () => {
    expect(CSS).toContain('.rotulo-acao{display:inline-grid;justify-items:center}');
    expect(CSS).toContain('.rotulo-acao>span{grid-area:1/1}');
  });

  it('esconde com visibility, que guarda o espaco, e nao com display', () => {
    expect(CSS).toContain('.rotulo-acao>span:last-child{visibility:hidden}');
    expect(CSS).toContain('.rotulo-acao[data-ativo]>span:first-child{visibility:hidden}');
    expect(CSS).not.toMatch(/\.rotulo-acao[^{]*\{[^}]*display:none/);
  });
});

describe('barra de rota', () => {
  it('esta no layout raiz, antes do conteudo', () => {
    const layout = readFileSync('app/layout.tsx', 'utf8');

    expect(layout).toMatch(/<body>[\s\S]*?<BarraDeRota \/>\s*\{children\}/);
  });

  it('com movimento reduzido fica parada, mas continua na tela', () => {
    expect(CSS).toContain('.barra-rota.on{animation:none;transform:scaleX(.6)}');
  });
});
