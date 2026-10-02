import { describe, expect, it } from 'vitest';
import { PROMPT_DO_CONCIERGE } from './prompt';

/**
 * O que o concierge diz sobre o frete (#201). O checkout mostra os servicos
 * que o Melhor Envio devolve, e hoje isso e so o SEDEX (#199). O concierge
 * nao pode prometer uma opcao que a pessoa nao vai encontrar.
 */
describe('o frete no concierge', () => {
  it('nao promete o PAC', () => {
    expect(PROMPT_DO_CONCIERGE).not.toMatch(/\bPAC\b/);
  });

  it('diz que o SEDEX entrega em qualquer regiao, e que pode haver mais opcao', () => {
    expect(PROMPT_DO_CONCIERGE).toContain('O SEDEX entrega em qualquer região do Brasil');
    expect(PROMPT_DO_CONCIERGE).toContain('dependendo da região, aparece mais opção de frete');
  });

  it('continua sem saber o valor do frete de ninguem', () => {
    expect(PROMPT_DO_CONCIERGE).toContain('Você não sabe o valor do frete de ninguém');
  });

  it('o prazo dos Correios conta depois da producao', () => {
    expect(PROMPT_DO_CONCIERGE).toContain('O prazo dos Correios conta depois da produção');
  });
});
