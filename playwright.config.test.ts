import { describe, expect, it } from 'vitest';
import config from './playwright.config';

/**
 * A suite de ponta a ponta tem chave publica do Mercado Pago (#274). O que
 * impede o SDK de verdade de sair para a rede e a regra de DNS do navegador,
 * e ela so vale para o projeto que a recebe. O Playwright monta o `use` de cada
 * projeto por cima do `use` de topo, chave por chave: um projeto novo, ou um
 * `launchOptions` proprio num projeto, derrubaria o bloqueio sem nenhum teste
 * falhar. Este confere a configuracao como o Playwright vai le-la.
 */
describe('playwright.config', () => {
  const projetos = config.projects ?? [];

  it('tem projetos', () => {
    expect(projetos.length).toBeGreaterThan(0);
  });

  it.each(projetos.map((p) => [p.name ?? '(sem nome)', p] as const))(
    'o projeto %s abre o navegador sem endereco para o Mercado Pago',
    (_nome, projeto) => {
      const use = { ...config.use, ...projeto.use };
      const regras = (use.launchOptions?.args ?? []).find((a) =>
        a.startsWith('--host-resolver-rules=')
      );
      expect(regras).toBeDefined();
      for (const dominio of ['mercadopago.com', 'mercadopago.com.br', 'mlstatic.com']) {
        expect(regras).toContain(`MAP *${dominio} ~NOTFOUND`);
      }
    }
  );
});
