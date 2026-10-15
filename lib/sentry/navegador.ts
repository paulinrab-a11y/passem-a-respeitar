import { opcoesComuns } from './opcoes';

/**
 * Opcoes do Sentry no navegador (#360): as comuns, menos tracing.
 *
 * Erro continua capturado sempre. Trace no navegador nao: o codigo dele sai
 * do bundle no build (lib/sentry/sem-tracing-no-navegador.cjs), e pedir uma
 * taxa de amostra sem o codigo so deixaria a config mentindo. Desempenho real
 * de quem visita ja vem da Vercel Speed Insights. Servidor e edge seguem com
 * `tracesSampleRate` das opcoes comuns.
 *
 * `browserApiErrors` sem `requestAnimationFrame`: por padrao a integracao
 * embrulha cada rAF para pegar erro dentro dele, e a cena da home chama rAF a
 * cada quadro. Erro ali ainda chega pelo `onerror` global, so sem o embrulho.
 *
 * A integracao chega por parametro porque so existe no pacote do navegador;
 * assim o teste roda em Node.
 */
export function opcoesDoNavegador<I>(
  dsn: string | undefined,
  browserApiErrors: (opcoes: { requestAnimationFrame: boolean }) => I
) {
  const { tracesSampleRate: _soNoServidor, ...comuns } = opcoesComuns(dsn);
  return {
    ...comuns,
    // Mesmo nome da padrao: o SDK fica com a ultima, e a ultima e esta.
    integrations: [browserApiErrors({ requestAnimationFrame: false })],
  };
}
