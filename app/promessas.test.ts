import { readdirSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * O site nao promete o que nao faz (#250). Invariantes lidas do codigo.
 *
 * Nenhum e-mail sai quando um pedido e criado, pago ou enviado: os unicos
 * e-mails sao os da conta, mandados pelo Supabase. O de pedido depende da
 * escolha do provedor (#55). Ate la, texto nenhum fala em avisar do pedido
 * por e-mail — quem le isso fecha a pagina e espera uma mensagem que nao vem.
 *
 * E a tela do Pix dizia que o pedido "muda de status aqui" sem nada mudar.
 * Agora ela confere sozinha, e o texto diz como; o Pix.test.tsx prova o resto.
 *
 * Quando o e-mail de pedido existir, esta lista encolhe junto com o PR dele.
 */
function fontes(raiz: string): string[] {
  return readdirSync(raiz, { withFileTypes: true }).flatMap((item) => {
    const caminho = join(raiz, item.name);
    if (item.isDirectory()) return fontes(caminho);
    return /\.tsx?$/.test(item.name) && !/\.test\.tsx?$/.test(item.name) ? [caminho] : [];
  });
}

const FONTES = [...fontes('app'), ...fontes('lib')].map((caminho) => ({
  caminho: caminho.split(sep).join('/'),
  texto: readFileSync(caminho, 'utf8'),
}));

/** Frases que prometem aviso de pedido por e-mail, ou tela que muda sozinha. */
const PROMESSAS: [string, RegExp][] = [
  ['avisar do pedido', /avis(?:amos|aremos|ar|o|os)\s+(?:de|do|sobre)\s+(?:o\s+)?pedido/i],
  ['aviso sobre os pedidos', /avisos?\s+sobre\s+(?:eles|seus\s+pedidos|o\s+pedido)/i],
  // So a do pedido: o e-mail de confirmacao da CONTA existe, e o Supabase manda.
  [
    'e-mail de confirmacao do pedido',
    /e-mail\s+de\s+confirma[cç][aã]o\s+(?:do|da)\s+(?:pedido|compra|pagamento)/i,
  ],
  [
    'mandar e-mail do pedido',
    /(?<!não\s)(?<!nao\s)(?:enviamos|mandamos|enviaremos|mandaremos)\s+(?:um\s+)?e-mail\s+(?:de|do|com\s+o|sobre\s+o)\s+pedido/i,
  ],
  ['receber e-mail do pedido', /receber(?:á|a)?\s+(?:um\s+)?e-mail\s+(?:de|do|com\s+o)\s+pedido/i],
  ['status que muda aqui', /muda\s+de\s+status\s+aqui/i],
];

describe('promessas do site', () => {
  it('acha os arquivos do site', () => {
    expect(FONTES.length).toBeGreaterThan(100);
    expect(FONTES.map((f) => f.caminho)).toContain('app/checkout/pagamento/[id]/Pix.tsx');
  });

  it.each(PROMESSAS)('ninguem promete: %s', (_nome, frase) => {
    const quem = FONTES.filter((f) => frase.test(f.texto)).map((f) => f.caminho);

    expect(quem).toEqual([]);
  });

  // Se as expressoes estivessem tortas, os testes acima passariam sem achar
  // nada. Estes amarram cada uma a frase que ela existe para pegar — as
  // promessas que estavam no ar antes da #250 — e a que ela deixa passar.
  it.each([
    ['é por ele que avisamos do pedido', 0],
    ['receber avisos sobre eles', 1],
    ['chega o e-mail de confirmação do pedido', 2],
    ['enviamos um e-mail com o pedido', 3],
    ['você vai receber um e-mail do pedido', 4],
    ['e o pedido muda de status aqui', 5],
  ])('a expressao pega "%s"', (frase, indice) => {
    expect(PROMESSAS[indice][1].test(frase)).toBe(true);
  });

  it('a negacao honesta e o e-mail da conta passam', () => {
    expect(PROMESSAS[3][1].test('Não enviamos e-mail de pedido')).toBe(false);
    expect(PROMESSAS[2][1].test('o link do e-mail de confirmação da conta')).toBe(false);
  });
});
