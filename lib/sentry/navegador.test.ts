import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import { opcoesDoNavegador } from './navegador';
import { opcoesComuns } from './opcoes';

const require = createRequire(import.meta.url);
const { troca } = require('./sem-tracing-no-navegador.cjs') as { troca: (f: string) => string };

const DSN = 'https://x@o1.ingest.sentry.io/1';

describe('opcoesDoNavegador', () => {
  const fabrica = vi.fn((opcoes: { requestAnimationFrame: boolean }) => ({
    name: 'BrowserApiErrors',
    opcoes,
  }));

  it('nao pede trace: o codigo dele nem vai ao navegador', () => {
    expect(opcoesDoNavegador(DSN, fabrica)).not.toHaveProperty('tracesSampleRate');
  });

  it('o servidor continua com trace', () => {
    expect(opcoesComuns(DSN).tracesSampleRate).toBeGreaterThan(0);
  });

  it('nao embrulha cada requestAnimationFrame', () => {
    const { integrations } = opcoesDoNavegador(DSN, fabrica);

    expect(fabrica).toHaveBeenCalledWith({ requestAnimationFrame: false });
    expect(integrations).toEqual([
      { name: 'BrowserApiErrors', opcoes: { requestAnimationFrame: false } },
    ]);
  });

  // O resto vem das opcoes comuns, sem copia: coleta desligada, beforeSend,
  // DSN e ambiente sao os mesmos do servidor.
  it('mantem as opcoes comuns', () => {
    const { tracesSampleRate: _, ...comuns } = opcoesComuns(DSN);
    const { integrations: __, ...doNavegador } = opcoesDoNavegador(DSN, fabrica);

    expect(doNavegador).toEqual(comuns);
  });

  it('sem DSN continua desligado', () => {
    expect(opcoesDoNavegador(undefined, fabrica).enabled).toBe(false);
  });
});

describe('loader sem tracing no navegador', () => {
  it('troca as duas marcas por false', () => {
    const saida = troca(
      'if (typeof __SENTRY_TRACING__ === "undefined" || __SENTRY_TRACING__) a();\n' +
        'const DEBUG_BUILD = typeof __SENTRY_DEBUG__ === "undefined" || __SENTRY_DEBUG__;'
    );

    expect(saida).not.toMatch(/__SENTRY_/);
    // `typeof false` e "boolean": os dois ramos viram codigo morto.
    expect(new Function(`let a = () => { throw 1 }; ${saida} return DEBUG_BUILD;`)()).toBe(false);
  });

  // O mapa de origem que chega ao loader segue adiante; ele so vale se
  // nenhuma coluna andar.
  it('mantem o comprimento de cada linha', () => {
    const entrada = 'x(__SENTRY_TRACING__, __SENTRY_DEBUG__);\ny(__SENTRY_TRACING__);';
    const saida = troca(entrada);

    expect(saida.split('\n').map((l) => l.length)).toEqual(
      entrada.split('\n').map((l) => l.length)
    );
  });

  it('nao toca em nome parecido', () => {
    const entrada = 'const __SENTRY_TRACING__X = 1; const MEU__SENTRY_DEBUG__ = 2;';
    expect(troca(entrada)).toBe(entrada);
  });

  it('chama o callback com o mapa que recebeu', () => {
    const loader = require('./sem-tracing-no-navegador.cjs') as (
      this: { callback: (...a: unknown[]) => void },
      fonte: string,
      mapa?: unknown
    ) => void;
    const callback = vi.fn();
    const mapa = { version: 3 };

    loader.call({ callback }, '__SENTRY_DEBUG__', mapa);

    expect(callback).toHaveBeenCalledWith(null, 'false           ', mapa);
  });
});
