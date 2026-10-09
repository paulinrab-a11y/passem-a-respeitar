import { describe, expect, it } from 'vitest';
import { LANCAMENTO } from '@/lib/lancamento';
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

/**
 * A data de lancamento (#269). O card do link publica a data; o concierge
 * confirma a mesma, em vez de negar que exista. A constante e as meta tags
 * sao conferidas em lib/lancamento.test.ts e app/layout.test.ts.
 */
describe('a data de lancamento no concierge', () => {
  it('diz a data da constante, a mesma das meta tags', () => {
    expect(PROMPT_DO_CONCIERGE).toContain(`Lançamento: ${LANCAMENTO.porExtenso}.`);
    expect(PROMPT_DO_CONCIERGE).toContain(`O lançamento é dia ${LANCAMENTO.porExtenso}`);
  });

  it('nao manda mais negar a data', () => {
    expect(PROMPT_DO_CONCIERGE).not.toContain('data ainda não anunciada');
    expect(PROMPT_DO_CONCIERGE).not.toContain('Nunca diga dia, mês ou ano');
    expect(PROMPT_DO_CONCIERGE).not.toMatch(/junto com o pré-save/);
  });

  it('o exemplo de "quando sai?" responde com a data', () => {
    const exemplo = PROMPT_DO_CONCIERGE.match(/Pergunta: quando sai\?\nResposta: (.*)/)?.[1];
    expect(exemplo).toContain(LANCAMENTO.porExtenso);
  });

  it('horario e link de pre-save seguem como o que ainda nao saiu', () => {
    expect(PROMPT_DO_CONCIERGE).toMatch(
      /Se perguntarem o que você não sabe \([^)]*horário do lançamento, link de pré-save/
    );
  });
});
