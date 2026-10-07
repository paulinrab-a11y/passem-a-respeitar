import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * A abertura nunca prende ninguem (#238). Lido do codigo, como os outros
 * testes do script legado: ele roda so no navegador, com three e GSAP de
 * verdade, e o que da para segurar daqui e a ORDEM e a FORMA do que protege.
 *
 *   - sem WebGL, o three lanca ao criar o renderer; a excecao fica dentro do
 *     bloco da cena, e o resto do script (intro, som, loja, convite) roda
 *   - com WebGL disponivel, a cena que lanca nao e "sem WebGL": o catch sonda
 *     o navegador antes de decidir, e o erro vai ao Sentry pelo runtime
 *   - a intro, o script e o runtime fecham a abertura pelo mesmo lugar
 *   - o runtime fecha a abertura quando o script nao chega, e 'pular'
 *     responde antes de o script existir
 */
const SCRIPT = readFileSync('app/_home/legacy-site.js', 'utf8');
const RUNTIME = readFileSync('app/_home/HomeRuntime.tsx', 'utf8');
const CSS = readFileSync('app/globals.css', 'utf8');
const HOME = readFileSync('app/page.tsx', 'utf8');

/** O corpo de uma funcao ou bloco, contando chaves a partir da assinatura. */
function corpo(texto: string, assinatura: string): string {
  const ini = texto.indexOf(assinatura);
  expect(ini, assinatura).toBeGreaterThan(-1);
  let i = texto.indexOf('{', ini) + 1;
  const comeco = i;
  for (let fundo = 1; i < texto.length && fundo > 0; i++) {
    if (texto[i] === '{') fundo++;
    else if (texto[i] === '}') fundo--;
  }
  return texto.slice(comeco, i - 1);
}

const posicao = (texto: string, trecho: string) => {
  const onde = texto.indexOf(trecho);
  expect(onde, trecho).toBeGreaterThan(-1);
  return onde;
};

describe('script da home: a cena 3D falha sozinha', () => {
  const abreCena = 'const GL = (()=>{ try {';
  const fechaCena = '} catch (erro) { return semWebGL(erro); } })();';

  it('o bloco da cena inteiro esta num try/catch que devolve o estado sem cena', () => {
    expect(SCRIPT).toContain(abreCena);
    expect(SCRIPT).toContain(fechaCena);
    // O renderer — onde o three lanca sem WebGL — nasce dentro do try.
    const renderer = posicao(
      SCRIPT,
      'new THREE.WebGLRenderer({ canvas, antialias:true, alpha:false'
    );
    expect(renderer).toBeGreaterThan(posicao(SCRIPT, abreCena));
    expect(renderer).toBeLessThan(posicao(SCRIPT, fechaCena));
  });

  it('o estado sem cena tem todo campo que a intro e o ScrollTrigger escrevem', () => {
    const stub = corpo(SCRIPT, 'function semWebGL(erro){');
    const campos = stub.match(/return \{ S:\{([^}]*)\}/)?.[1] ?? '';
    const declarados = [...campos.matchAll(/(\w+):/g)].map((m) => m[1]);
    const usados = [...new Set([...SCRIPT.matchAll(/GL\.S\.(\w+)/g)].map((m) => m[1]))];

    expect(usados.length).toBeGreaterThan(3);
    expect(usados.filter((campo) => !declarados.includes(campo))).toEqual([]);
    // A corrente ja esta no lugar: nao ha queda para animar sem cena.
    expect(campos).toContain('queda:1');
  });

  it('sem WebGL a raiz e marcada, e o CSS tira o canvas e mostra os elos', () => {
    expect(corpo(SCRIPT, 'function semWebGL(erro){')).toContain(
      "document.documentElement.classList.add('sem-webgl')"
    );
    expect(CSS).toContain('html.sem-webgl #gl{display:none}');
    expect(CSS).toContain('html.sem-webgl .elo .box{opacity:1;transform:none}');
  });

  it('o catch sonda o navegador antes de decidir o tom: sem contexto avisa, com contexto reporta', () => {
    const stub = corpo(SCRIPT, 'function semWebGL(erro){');
    expect(SCRIPT).toContain("import { temWebGL } from './webgl';");
    // A sondagem vem antes do aviso: e ela que escolhe entre os dois.
    expect(posicao(stub, 'if (temWebGL()) {')).toBeLessThan(posicao(stub, 'console.warn('));
    // Com WebGL o erro e da cena e vai a quem o runtime indicou; o script nao
    // conhece o Sentry, como nao conhece o Turnstile.
    expect(stub).toContain('if (reporta) reporta(erro);');
    expect(SCRIPT).toContain(
      "const reporta = (extras && typeof extras.reporta === 'function') ? extras.reporta : null;"
    );
    expect(SCRIPT).not.toMatch(/from '@sentry/);
    // E a pagina fica igual nos dois casos: a marca na raiz e o estado sem
    // cena vem depois do if/else, fora dele.
    expect(posicao(stub, "classList.add('sem-webgl')")).toBeGreaterThan(
      posicao(stub, 'console.warn(')
    );
  });

  it('nenhum dos dois caminhos leva nada da pessoa: a mensagem no aviso, o erro no reporte', () => {
    const stub = corpo(SCRIPT, 'function semWebGL(erro){');
    expect(stub).toMatch(/console\.warn\('home: sem WebGL[^']*', erro && erro\.message\)/);
    expect(stub).toMatch(/console\.error\('home: a cena 3D falhou[^']*', erro\)/);
    expect(stub).not.toContain('navigator');
  });

  it('a intro continua depois da cena: e ela que precisa do estado, nao o contrario', () => {
    expect(posicao(SCRIPT, 'function semWebGL(erro){')).toBeLessThan(posicao(SCRIPT, abreCena));
    expect(posicao(SCRIPT, fechaCena)).toBeLessThan(posicao(SCRIPT, '(function intro(){'));
  });
});

describe('script da home: a intro e o runtime fecham pelo mesmo lugar', () => {
  const intro = corpo(SCRIPT, '(function intro(){');

  it('o script importa o fechamento compartilhado', () => {
    expect(SCRIPT).toContain("import { fechaAbertura } from './abertura';");
  });

  it('fecha() delega o DOM e nao mexe mais na trava nem na barra por conta propria', () => {
    const fecha = corpo(intro, 'function fecha(){');

    expect(fecha).toContain('fechaAbertura(document)');
    expect(fecha).not.toContain("classList.remove('locked')");
    expect(fecha).not.toContain("'#bar'");
    expect(fecha).not.toContain("classList.add('out')");
    // O que e so da intro continua nela: os dois lacos param e o ScrollTrigger
    // mede a pagina destravada.
    expect(fecha).toContain('vhsOn=false; tcOn=false;');
    expect(fecha).toContain('ScrollTrigger.refresh();');
  });

  it('o pular anotado pelo runtime vale assim que a intro existe, pelo botao de verdade', () => {
    expect(SCRIPT).toContain('const pulouAntes = !!(extras && extras.pulou);');
    // Depois do listener do botao, e nao antes: `.click()` precisa de alguem ouvindo.
    const clique = posicao(intro, "if (pulouAntes) $('#skip').click();");
    expect(clique).toBeGreaterThan(
      posicao(intro, "$('#skip').addEventListener('click', ()=>{ tl.progress(1).kill();")
    );
  });

  it('ninguem mais no script tranca a rolagem da intro', () => {
    expect(SCRIPT.match(/html\.classList\.add\('locked'\)/g)).toHaveLength(1);
  });
});

describe('HomeRuntime: o script que nao chega nao prende ninguem', () => {
  it("'pular' e anotado antes de qualquer import dinamico, e o script recebe a anotacao", () => {
    const pular = posicao(RUNTIME, "getElementById('skip')");
    expect(pular).toBeLessThan(posicao(RUNTIME, "import('three')"));
    expect(RUNTIME).toMatch(
      /getElementById\('skip'\)\s*\?\.addEventListener\(\s*'click',\s*\(\) => \{\s*pulou = true;\s*\},\s*\{ signal: anota\.signal \}\s*\)/
    );
    // Anotado, nao executado: o runtime so fecha a abertura no catch.
    expect(RUNTIME.match(/fechaAbertura\(document\)/g)).toHaveLength(1);
    expect(RUNTIME).toMatch(/legacy\.default\(CONFIG, \{[^}]*\bpulou,/);
    // E o listener sai quando o init termina, com ou sem sucesso, e quando o
    // runtime desmonta.
    expect(RUNTIME.match(/anota\.abort\(\)/g)).toHaveLength(2);
    expect(RUNTIME).toMatch(/finally \{\s*anota\.abort\(\);\s*\}/);
  });

  it('a falha do import ou do init fecha a abertura e avisa o Sentry', () => {
    const efeito = corpo(RUNTIME, 'useEffect(() => {');
    const falha = corpo(efeito, 'catch (erro) {');

    expect(falha).toContain('if (cancelado) return;');
    expect(falha).toContain('fechaAbertura(document);');
    expect(falha).toContain("Sentry.captureException(erro, { tags: { onde: 'home-init' } });");
    // O init do script esta dentro do try: e dele que a excecao sai.
    expect(posicao(efeito, 'legacy.default(CONFIG, {')).toBeLessThan(
      posicao(efeito, 'catch (erro) {')
    );
  });

  it('o script recebe quem reporta a cena: o Sentry, com a tag home-cena', () => {
    const efeito = corpo(RUNTIME, 'useEffect(() => {');
    const init = efeito.slice(
      posicao(efeito, 'legacy.default(CONFIG, {'),
      posicao(efeito, 'catch (erro) {')
    );
    expect(init).toMatch(
      /reporta: \(erro: unknown\) =>\s*Sentry\.captureException\(erro, \{ tags: \{ onde: 'home-cena' \} \}\)/
    );
    // Tag diferente da falha do init: "chegou e a cena quebrou" nao e "nao chegou".
    expect(efeito.match(/onde: 'home-init'/g)).toHaveLength(1);
    expect(efeito.match(/onde: 'home-cena'/g)).toHaveLength(1);
  });

  it('concierge e ancora vem depois do try/catch: a pagina segue mesmo sem a cena', () => {
    const efeito = corpo(RUNTIME, 'useEffect(() => {');
    const depoisDaFalha = posicao(efeito, 'catch (erro) {');

    expect(posicao(efeito, 'montaConcierge({')).toBeGreaterThan(depoisDaFalha);
    expect(posicao(efeito, 'levaAteAAncora(window)')).toBeGreaterThan(depoisDaFalha);
  });

  it("o botao 'pular' vem do servidor, dentro da abertura: ha onde pendurar o listener", () => {
    const abertura = HOME.slice(HOME.indexOf('<div id="intro"'), HOME.indexOf('<main>'));
    expect(abertura).toContain('<button type="button" id="skip">');
  });
});
