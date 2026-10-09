import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Guarda da #22: toda rota de API e toda server action limitam, e todo 429
 * diz quando voltar.
 *
 * E um teste sobre o CODIGO, nao sobre o comportamento — de proposito. O
 * comportamento de cada limite ja tem teste no proprio arquivo; o que
 * ninguem testa e a rota que ainda nao existe. Quem criar uma sem `limita()`
 * ve este teste cair no primeiro CI, com o nome do arquivo.
 */

const RAIZ = join(__dirname, '..');

function arquivos(dir: string, pega: (nome: string) => boolean, saida: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) arquivos(caminho, pega, saida);
    else if (pega(nome)) saida.push(caminho);
  }
  return saida;
}

const rotas = arquivos(join(RAIZ, 'api'), (n) => n === 'route.ts');
const acoes = arquivos(RAIZ, (n) => /^(acoes|excluir|email)\.ts$/.test(n));

const relativo = (c: string) => c.slice(RAIZ.length).replace(/\\/g, '/');

/**
 * Cada `export async function` com o que vem depois dela ate a proxima. E o
 * suficiente para saber se o `limita(` esta na MESMA funcao que le a senha,
 * e nao em outra do mesmo arquivo.
 */
function funcoesExportadas(fonte: string) {
  return fonte
    .split(/^export async function /m)
    .slice(1)
    .map((trecho) => ({ nome: trecho.slice(0, trecho.indexOf('(')), corpo: trecho }));
}

/** Os campos de senha dos formularios: a senha de login e a "atual" da troca. */
const LE_SENHA = /form\.get\(['"](senha|atual)['"]\)/;

/**
 * Limites compartilhados que valem como `limita()` (#284). O codigo do
 * cadastro e conferido em mais de uma tela, e o contador precisa ser um so:
 * por isso a acao que confirma o cadastro, e le a senha escolhida, limita por
 * `cabeConferencia`, de lib/conta/codigo.ts. Um nome so entra aqui se a
 * funcao dele chamar `limita()` — conferido abaixo.
 */
const COMPARTILHADOS = ['cabeConferencia'];
const LIMITA = new RegExp(`\\b(limita|${COMPARTILHADOS.join('|')})\\(`);

describe('toda rota de API limita', () => {
  it('existe pelo menos uma rota (senao o teste nao testa nada)', () => {
    expect(rotas.length).toBeGreaterThan(0);
  });

  it.each(rotas.map((c) => [relativo(c), c]))('%s chama limita()', (_nome, caminho) => {
    expect(readFileSync(caminho, 'utf8')).toMatch(/\blimita\(/);
  });

  // 429 sem Retry-After e um "nao" sem "ate quando". Cliente honesto nao sabe
  // se espera um segundo ou uma hora; o provedor de pagamento reenvia no
  // escuro.
  it.each(rotas.map((c) => [relativo(c), c]))(
    '%s manda Retry-After em todo 429',
    (_nome, caminho) => {
      const fonte = readFileSync(caminho, 'utf8');
      const quantos429 = (fonte.match(/status: 429/g) ?? []).length;
      const quantosRetry = (fonte.match(/'Retry-After'/g) ?? []).length;

      expect(quantosRetry).toBeGreaterThanOrEqual(quantos429);
    }
  );
});

describe('toda server action com escrita limita', () => {
  it('acha as acoes conhecidas', () => {
    expect(acoes.map(relativo)).toEqual(
      expect.arrayContaining(['/entrar/acoes.ts', '/checkout/acoes.ts', '/conta/acoes.ts'])
    );
  });

  it.each(acoes.map((c) => [relativo(c), c]))('%s chama limita()', (_nome, caminho) => {
    expect(readFileSync(caminho, 'utf8')).toMatch(/\blimita\(/);
  });
});

/**
 * Por funcao, nao so por arquivo (#244): a reautenticacao passou sem limite
 * num arquivo que "chamava limita()" — era a troca de senha ao lado que
 * chamava. Ler uma senha do formulario e o que custa: cada chamada vai ao
 * Supabase conferir o hash, e e isso que quem adivinha senha explora.
 */
describe('toda funcao que le senha do formulario limita', () => {
  const casos = acoes.flatMap((caminho) =>
    funcoesExportadas(readFileSync(caminho, 'utf8'))
      .filter((f) => LE_SENHA.test(f.corpo))
      .map((f) => [`${relativo(caminho)} ${f.nome}`, f.corpo] as const)
  );

  it('acha as funcoes conhecidas', () => {
    expect(casos.map(([nome]) => nome)).toEqual(
      expect.arrayContaining([
        '/entrar/acoes.ts entrar',
        '/conta/seguranca/acoes.ts trocarSenha',
        '/conta/seguranca/acoes.ts reautenticarEEncerrar',
        '/conta/seguranca/email.ts trocarEmail',
        '/conta/seguranca/excluir.ts excluirConta',
        '/criar-conta/acoes.ts confirmarCadastro',
      ])
    );
  });

  it.each(casos)('%s chama limita()', (_nome, corpo) => {
    expect(corpo).toMatch(LIMITA);
  });

  it.each(COMPARTILHADOS)('o limite compartilhado %s chama limita()', (nome) => {
    const fonte = readFileSync(join(RAIZ, '..', 'lib', 'conta', 'codigo.ts'), 'utf8');
    const funcao = funcoesExportadas(fonte).find((f) => f.nome === nome);

    expect(funcao?.corpo).toMatch(/\blimita\(/);
  });
});
