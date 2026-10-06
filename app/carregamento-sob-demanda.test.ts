import { readdirSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Invariantes da #47 que nenhum lint pega.
 *
 * Lidas do codigo-fonte, e nao do bundle: o bundle so existe depois do build,
 * e o que decide o que entra nele e quem importa o que. Se alguem importar
 * three.js numa tela da conta, o primeiro CI acusa, com o nome do arquivo.
 */
function arquivos(raiz: string): string[] {
  return readdirSync(raiz, { withFileTypes: true }).flatMap((item) => {
    const caminho = join(raiz, item.name);
    if (item.isDirectory()) return item.name === 'node_modules' ? [] : arquivos(caminho);
    return /\.(ts|tsx|js)$/.test(item.name) && !/\.test\.(ts|tsx)$/.test(item.name)
      ? [caminho]
      : [];
  });
}

const FONTES = [...arquivos('app'), ...arquivos('lib'), 'proxy.ts'].map((caminho) => ({
  caminho: caminho.split(sep).join('/'),
  texto: readFileSync(caminho, 'utf8'),
}));

const PESADOS = ['three', 'gsap'];
const importaEstatico = (texto: string, pacote: string) =>
  new RegExp(`^\\s*import\\s[^;]*from\\s+['"]${pacote}(/[^'"]*)?['"]`, 'm').test(texto);
const importaDinamico = (texto: string, pacote: string) =>
  new RegExp(`import\\(\\s*['"]${pacote}(/[^'"]*)?['"]\\s*\\)`).test(texto);

describe('three.js e GSAP ficam fora de tudo que nao e a home', () => {
  it('acha os arquivos', () => {
    expect(FONTES.length).toBeGreaterThan(60);
  });

  it.each(PESADOS)('ninguem importa %s de forma estatica', (pacote) => {
    const quem = FONTES.filter((f) => importaEstatico(f.texto, pacote)).map((f) => f.caminho);

    expect(quem).toEqual([]);
  });

  it.each(PESADOS)('%s so entra por import dinamico, e so no runtime da home', (pacote) => {
    const quem = FONTES.filter((f) => importaDinamico(f.texto, pacote)).map((f) => f.caminho);

    expect(quem).toEqual(['app/_home/HomeRuntime.tsx']);
  });

  it('o runtime da home so e usado pela home', () => {
    const quem = FONTES.filter((f) => /from\s+['"][^'"]*HomeRuntime['"]/.test(f.texto)).map(
      (f) => f.caminho
    );

    expect(quem).toEqual(['app/page.tsx']);
  });

  it('o script legado so e carregado pelo runtime da home', () => {
    const quem = FONTES.filter((f) => /legacy-site['"]/.test(f.texto)).map((f) => f.caminho);

    expect(quem).toEqual(['app/_home/HomeRuntime.tsx']);
  });
});

describe('imagens', () => {
  const home = readFileSync('app/page.tsx', 'utf8');

  it('priority existe uma vez no site inteiro, no logo do hero', () => {
    const comPriority = FONTES.filter((f) => /^\s*priority\b/m.test(f.texto)).map((f) => f.caminho);

    expect(comPriority).toEqual(['app/page.tsx']);
    expect(home.match(/^\s*priority\b/gm)).toHaveLength(1);
    expect(home).toMatch(/<h1 id="logoHero">\s*<Image[\s\S]*?priority[\s\S]*?\/>/);
  });

  it('a galeria e o componente com next/image, e nao HTML montado pelo script', () => {
    const script = readFileSync('app/_home/legacy-site.js', 'utf8');

    expect(home).toContain('<Galeria fotos={CONFIG.merchFotos}');
    expect(script).not.toMatch(/galeriaMerch['"]?\)?\.innerHTML/);
    expect(script).not.toMatch(/g\.innerHTML\s*=/);
    expect(script).not.toMatch(/\$\('#logoHero'\)\.innerHTML/);
  });
});

describe('script da home: nada pesado no carregamento inicial', () => {
  const script = readFileSync('app/_home/legacy-site.js', 'utf8');

  /** O corpo de uma funcao nomeada, contando chaves. */
  function corpo(assinatura: string): string {
    const ini = script.indexOf(assinatura);
    expect(ini, assinatura).toBeGreaterThan(-1);
    let i = script.indexOf('{', ini) + 1;
    const comeco = i;
    for (let fundo = 1; i < script.length && fundo > 0; i++) {
      if (script[i] === '{') fundo++;
      else if (script[i] === '}') fundo--;
    }
    return script.slice(comeco, i - 1);
  }

  it('PNG cromado so baixa de dentro do observador de elo', () => {
    const elementos = corpo('(function elementos(){');

    // A chamada de rede fica guardada num mapa; quem dispara e `carrega`.
    expect(elementos).toContain('carregadores.set(e, ()=> loader.load(');
    expect(elementos).toContain('new IntersectionObserver');
    expect(elementos).toMatch(/rootMargin:'150% 0px'/);
    // Nenhum `loader.load` solto no laco, fora da funcao guardada.
    expect(elementos.match(/loader\.load\(/g)).toHaveLength(2);
    expect(elementos).not.toMatch(/^\s*loader\.load\(/m);
  });

  it('sem IntersectionObserver carrega tudo, em vez de nao carregar nada', () => {
    expect(corpo('(function elementos(){')).toContain(
      "if (!('IntersectionObserver' in window)){ lista.forEach(carrega); return; }"
    );
  });

  it('o clipe so e montado quando a secao chega perto', () => {
    const ini = script.indexOf('if (CONFIG.clipe.blick){');
    const clipe = script.slice(ini, script.indexOf('(function montaElos(){'));

    expect(clipe).toContain('const montaClipe = ()=>{');
    expect(clipe).toContain("vigiaClipe.observe($('#clipe'))");
    // Fora da funcao, nada escreve no player.
    const fora = clipe.replace(corpo('const montaClipe = ()=>{'), '');
    expect(fora).not.toContain('innerHTML');
  });

  it('modelo 3D e foto 360 so baixam quando a loja abre', () => {
    const abre = corpo('function abre(t, quem){');

    expect(abre).toContain('if (querFotos()) init360(); else init();');
    // E ninguem mais chama os dois.
    expect(script.match(/\binit360\(\)/g)).toHaveLength(2);
    expect(corpo('function init360(){')).toContain('giro.style.backgroundImage');
    expect(
      corpo('function init(){\n    if (pronto) return; pronto = true;\n    renderer')
    ).toContain('new THREE.GLTFLoader()');
  });

  it('beat so baixa quando o som e ligado', () => {
    expect(script.match(/new Audio\(\)/g)).toHaveLength(1);
    expect(corpo('function tocaBeat(){')).toContain('new Audio()');
    // `tocaBeat` so e chamado de dentro do player e de `liga`.
    const chamadas = script.match(/\btocaBeat\(\)/g) ?? [];
    expect(chamadas.length).toBeGreaterThan(1);
    expect(corpo('function liga(){')).toContain('tocaBeat()');
  });
});
