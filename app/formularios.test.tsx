// @vitest-environment jsdom

import { readdirSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { comErro } from './_ui/campos';
import Erro from './_ui/Erro';
import { fimDaAnimacao } from './_ui/fim-da-animacao';

/**
 * Formularios (#51): erro com lugar reservado, campo marcado e ligado a
 * mensagem, foco visivel, rotulo que nao some.
 */
const CSS = readFileSync('app/globals.css', 'utf8');

afterEach(cleanup);

describe('Erro', () => {
  it('sem erro, o lugar existe vazio e nao anuncia nada', () => {
    const { container } = render(<Erro id="e" texto={null} tentativa={0} />);
    const vaga = container.firstElementChild as HTMLElement;

    expect(vaga.className).toBe('erro-vaga');
    expect(vaga.children).toHaveLength(0);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(vaga.hasAttribute('role')).toBe(false);
    expect(vaga.hasAttribute('aria-live')).toBe(false);
  });

  it('com erro, o paragrafo entra DENTRO do lugar, com id e alerta', () => {
    const { container } = render(<Erro id="auth-erro" texto="Confira o e-mail." tentativa={1} />);
    const vaga = container.firstElementChild as HTMLElement;
    const p = vaga.querySelector('p') as HTMLElement;

    expect(vaga.children).toHaveLength(1);
    expect(p.id).toBe('auth-erro');
    expect(p.getAttribute('role')).toBe('alert');
    expect(p.className).toBe('auth-erro');
    expect(p.textContent).toBe('Confira o e-mail.');
  });

  it('o mesmo erro numa tentativa nova e um paragrafo novo: reanima e reanuncia', () => {
    const { container, rerender } = render(<Erro id="e" texto="Errou." tentativa={1} />);
    const primeiro = container.querySelector('p');

    rerender(<Erro id="e" texto="Errou." tentativa={2} />);

    // O antigo sai primeiro (#155); o novo entra quando a saida acaba.
    expect(container.querySelector('p')).toBe(primeiro);
    expect(primeiro?.className).toBe('auth-erro saindo');

    fimDaAnimacao(primeiro as HTMLElement);

    const segundo = container.querySelector('p');
    expect(segundo).not.toBe(primeiro);
    expect(segundo?.className).toBe('auth-erro');
    expect(segundo?.textContent).toBe('Errou.');
  });

  it('a mesma tentativa nao remonta o paragrafo', () => {
    const { container, rerender } = render(<Erro id="e" texto="Errou." tentativa={1} />);
    const primeiro = container.querySelector('p');

    rerender(<Erro id="e" texto="Errou." tentativa={1} />);

    expect(container.querySelector('p')).toBe(primeiro);
  });
});

describe('comErro', () => {
  it('sem erro nao marca nem aponta para id que nao existe', () => {
    expect(comErro(false, 'auth-erro')).toEqual({
      'aria-invalid': undefined,
      'aria-describedby': undefined,
    });
  });

  it('com erro marca o campo e liga a mensagem', () => {
    expect(comErro(true, 'auth-erro')).toEqual({
      'aria-invalid': true,
      'aria-describedby': 'auth-erro',
    });
  });

  it('a descricao que o campo ja tinha continua valendo, com ou sem erro', () => {
    expect(comErro(false, 'auth-erro', 'forca-da-senha')['aria-describedby']).toBe(
      'forca-da-senha'
    );
    expect(comErro(true, 'auth-erro', 'forca-da-senha')['aria-describedby']).toBe(
      'forca-da-senha auth-erro'
    );
  });
});

function fontes(raiz: string, extensao: RegExp): { caminho: string; texto: string }[] {
  return readdirSync(raiz, { withFileTypes: true }).flatMap((item) => {
    const caminho = join(raiz, item.name);
    if (item.isDirectory()) return fontes(caminho, extensao);
    return extensao.test(item.name) && !/\.test\.(ts|tsx)$/.test(item.name)
      ? [{ caminho: caminho.split(sep).join('/'), texto: readFileSync(caminho, 'utf8') }]
      : [];
  });
}

const CHECKOUT = 'app/checkout/Entrega.tsx';

const FORMULARIOS = [
  'app/entrar/Formulario.tsx',
  'app/criar-conta/Formulario.tsx',
  'app/recuperar-senha/Formulario.tsx',
  'app/redefinir-senha/Formulario.tsx',
  'app/conta/seguranca/TrocarSenha.tsx',
  'app/conta/seguranca/TrocarEmail.tsx',
  // Ficou de fora da #51 e voltou a ter campo marcado sem motivo (#47).
  CHECKOUT,
];

describe('os formularios da issue', () => {
  it.each(FORMULARIOS)('%s: todo campo de texto marca erro e liga a mensagem', (arquivo) => {
    const texto = readFileSync(arquivo, 'utf8');
    const campos = [...texto.matchAll(/<input\b[\s\S]*?\/>/g)]
      .map((m) => m[0])
      .filter((c) => !/type="(hidden|checkbox)"/.test(c));

    expect(campos.length).toBeGreaterThan(0);
    for (const campo of campos) {
      expect(campo, campo.slice(0, 80)).toMatch(/\{\.\.\.(comErro|erroEm)\(/);
    }
  });

  it.each(FORMULARIOS)('%s: nenhum aria-invalid escrito a mao, sem a ligacao', (arquivo) => {
    expect(readFileSync(arquivo, 'utf8')).not.toMatch(/aria-invalid=/);
  });

  it.each(FORMULARIOS.slice(0, 4))('%s: o erro usa o lugar reservado', (arquivo) => {
    const texto = readFileSync(arquivo, 'utf8');

    // Nos tres formularios publicos, o aviso da protecao contra bot (#28) usa
    // o mesmo lugar, e vem na frente quando existe.
    expect(texto).toMatch(/<Erro\s+id="auth-erro"\s+texto=\{(robo\.aviso \?\? )?estado\.erro\}/);
    expect(texto).not.toMatch(/\{estado\.erro \? \(/);
  });

  it('troca de e-mail: o recado entra num lugar reservado', () => {
    const texto = readFileSync('app/conta/seguranca/TrocarEmail.tsx', 'utf8');

    expect(texto).toMatch(/<div className="erro-vaga">[\s\S]*id="recado-do-email"/);
  });

  it('checkout: o recado do servidor entra num lugar reservado, com o id que os campos apontam', () => {
    const texto = readFileSync(CHECKOUT, 'utf8');

    expect(texto).toContain("const ID_DO_ERRO = 'erro-entrega';");
    expect(texto).toMatch(/<div className="erro-vaga">\s*<Mensagem\s+id=\{ID_DO_ERRO\}/);
    // Os campos de texto, os radios do frete e a caixinha dos termos (#276).
    expect(texto.match(/\{\.\.\.comErro\([^)]*, ID_DO_ERRO\)\}/g)).toHaveLength(3);
  });

  it('troca de senha: o aviso de erro interrompe, o de sucesso espera', () => {
    const texto = readFileSync('app/conta/seguranca/TrocarSenha.tsx', 'utf8');

    expect(texto).toContain("role={estado.recado.tom === 'erro' ? 'alert' : 'status'}");
    expect(texto).toContain('id="aviso-da-senha"');
  });

  // No checkout os campos saem de uma lista, e o par rotulo-campo nao aparece
  // no fonte. Ele e cobrado na tela, em app/checkout/Entrega.test.tsx.
  it.each(FORMULARIOS.filter((f) => f !== CHECKOUT))(
    '%s: todo campo tem rotulo de texto, e nenhum usa placeholder',
    (arquivo) => {
      const texto = readFileSync(arquivo, 'utf8');
      const rotulos = [
        ...texto.matchAll(/<label className="auth-campo">\s*<span>([^<]+)<\/span>/g),
      ];
      const campos = [...texto.matchAll(/<input\b[\s\S]*?\/>/g)].filter(
        (m) => !/type="(hidden|checkbox)"/.test(m[0])
      );

      expect(rotulos.length).toBe(campos.length);
      expect(texto).not.toMatch(/placeholder=/);
    }
  );
});

/**
 * O campo do codigo de confirmacao (#224, #260) mora em `_ui` e serve ao
 * cadastro, ao login e a /conta. O rotulo dele tem classe a mais
 * (`codigo-campo`), por isso fica fora da lista acima; o resto vale igual.
 */
describe('campo do codigo de confirmacao', () => {
  const texto = readFileSync('app/_ui/CodigoDeConfirmacao.tsx', 'utf8');

  it('marca erro e liga a mensagem pelo comErro, sem aria-invalid escrito a mao', () => {
    expect(texto).toMatch(/\{\.\.\.comErro\(Boolean\(estado\.erro\), 'codigo-erro'/);
    expect(texto).not.toMatch(/aria-invalid=/);
  });

  it('o erro e o recado do reenvio usam o lugar reservado', () => {
    expect(texto).toMatch(/<Erro\s+id="codigo-erro"/);
    expect(texto).toMatch(/<Erro\s+id="reenvio-recado"/);
  });

  it('o campo tem rotulo de texto, e nenhum placeholder', () => {
    expect(texto).toMatch(/<label className="auth-campo codigo-campo">\s*<span>Código de/);
    expect(texto).not.toMatch(/placeholder=/);
  });
});

describe('codigo de convite', () => {
  const home = readFileSync('app/page.tsx', 'utf8');
  const script = readFileSync('app/_home/legacy-site.js', 'utf8');

  it('o campo tem rotulo proprio e ligacao com a mensagem', () => {
    expect(home).toMatch(/<label htmlFor="cod">[^<]+<\/label>/);
    expect(home).toMatch(/id="cod"[\s\S]*?aria-describedby="erroCod"/);
    expect(home).toMatch(/id="erroCod" aria-live="polite"/);
  });

  it('o script marca o campo no erro e desmarca na tentativa seguinte', () => {
    expect(script.match(/inp\.setAttribute\('aria-invalid','true'\)/g)).toHaveLength(2);
    expect(script).toContain("inp.removeAttribute('aria-invalid')");
  });

  it('o lugar da mensagem ja era reservado', () => {
    expect(CSS).toMatch(/#fim \.convite \.erro\{[^}]*min-height:16px/);
  });
});

describe('lugar reservado no CSS', () => {
  it('duas linhas no computador, tres no telefone, na altura de linha do erro', () => {
    expect(CSS).toContain(
      '.erro-vaga{font-size:13px;line-height:1.45;min-height:calc(2 * 1.45em)}'
    );
    expect(CSS).toMatch(
      /@media \(max-width:767px\)\{\s*\.erro-vaga\{min-height:calc\(3 \* 1\.45em\)\}/
    );
  });

  it('a tipografia do lugar e a mesma do erro', () => {
    const erro = CSS.match(/(?:^|\n)\.auth-erro\{([^}]*)\}/)?.[1] ?? '';

    expect(erro).toContain('font-size:13px');
    expect(erro).toContain('line-height:1.45');
  });

  it('nenhuma mensagem de erro dos formularios passa do lugar reservado', () => {
    // 58 caracteres por linha e o que cabe em 420px com a fonte de 13px e
    // o recuo da borda. Duas linhas no computador. O checkout tem 560px e
    // nenhum recuo: o limite dos outros sobra para ele. Medido na #261: a
    // mais longa dele, a do e-mail nao confirmado (97), da 2 linhas no
    // computador e 3 em 320px.
    const LIMITE = 58 * 2;
    const acoes = [
      'app/entrar/acoes.ts',
      'app/criar-conta/acoes.ts',
      'app/recuperar-senha/acoes.ts',
      'app/redefinir-senha/acoes.ts',
      'app/conta/seguranca/email.ts',
      'app/checkout/acoes.ts',
      // As frases do frete tambem voltam do Finalizar: o pedido cota de novo.
      'lib/loja/recados-do-frete.ts',
      // O aviso de /conta ganhou o lugar reservado do campo do codigo (#260).
      'app/conta/acoes.ts',
    ].map((a) => readFileSync(a, 'utf8'));

    const mensagens = acoes.flatMap((t) =>
      [...t.matchAll(/'((?:[^'\\]|\\.){25,})'/g)]
        .map((m) => m[1])
        .filter((m) => /[a-zà-ú] [a-zà-ú]/i.test(m) && /[.!]$/.test(m))
    );

    expect(mensagens.length).toBeGreaterThanOrEqual(10);
    expect(mensagens.filter((m) => m.length > LIMITE)).toEqual([]);
  });
});

describe('foco visivel', () => {
  it('o outline vermelho da identidade vale para tudo que recebe foco', () => {
    expect(CSS).toContain(':focus-visible{outline:2px solid var(--vermelho);outline-offset:4px}');
  });

  it('nenhuma regra apaga o outline', () => {
    const apagam = [...CSS.matchAll(/([^{}\n]+)\{[^}]*outline\s*:\s*(?:none|0)\b[^}]*\}/g)].map(
      (m) => m[1].trim()
    );

    expect(apagam).toEqual([]);
  });

  it('nenhum componente apaga o outline por style inline', () => {
    const quem = fontes('app', /\.tsx$/)
      .filter((f) => /outline:\s*['"]?(none|0)\b/.test(f.texto))
      .map((f) => f.caminho);

    expect(quem).toEqual([]);
  });
});

describe('campo com erro', () => {
  it('tem borda vermelha nos formularios e no convite', () => {
    expect(CSS).toContain(
      '.auth-campo input[aria-invalid="true"],#fim .convite input[aria-invalid="true"]{border-color:var(--vermelho)}'
    );
  });

  it('o erro entra com animacao curta e so com opacity e transform', () => {
    expect(CSS).toMatch(/\.auth-erro\{[^}]*animation:auth-erro-entra \.16s /);
    expect(CSS).toContain(
      '@keyframes auth-erro-entra{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}'
    );
  });
});
