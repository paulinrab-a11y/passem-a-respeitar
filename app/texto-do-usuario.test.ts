import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Texto que vem do usuario ou do ViaCEP nao tem tamanho garantido: nome de 80
 * caracteres, palavra sem espaco, e-mail comprido, logradouro de cartorio.
 *
 * Sem `overflow-wrap:anywhere`, uma palavra so mais larga que a tela alarga a
 * `.auth-caixa` (o grid do `.auth` dimensiona pela largura minima do conteudo)
 * e a pagina inteira ganha rolagem lateral no telefone. Medido a 320px, numa
 * pagina com o CSS daqui e dados de pior caso: ia a 1544px de largura; com a regra,
 * fica nos 320.
 *
 * `anywhere`, e nao `break-word`: so `anywhere` entra no calculo da largura
 * minima. E nao `word-break:break-all`, que parte qualquer palavra no meio
 * mesmo quando cabia inteira na linha de baixo.
 */
const CSS = readFileSync('app/globals.css', 'utf8');

/** Declaracoes de um seletor exato, juntando todas as regras dele. */
function declaracoes(seletor: string) {
  const escapado = seletor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regra = new RegExp(`(?:^|[}\\s,])${escapado}\\s*\\{([^}]*)\\}`, 'g');
  return [...CSS.matchAll(regra)].map((m) => m[1]).join(';');
}

describe('texto de pior caso nao alarga a pagina', () => {
  it.each([
    '.conta-nome',
    '.conta-email',
    '.entrega-nome',
    '.entrega-endereco',
    '.pedido-item-nome',
    '.admin-entrega-corpo p',
  ])('%s quebra em qualquer ponto quando precisa', (seletor) => {
    expect(declaracoes(seletor)).toMatch(/overflow-wrap:\s*anywhere/);
  });

  it('ninguem usa word-break:break-all', () => {
    expect(CSS).not.toMatch(/word-break:\s*break-all/);
  });
});
