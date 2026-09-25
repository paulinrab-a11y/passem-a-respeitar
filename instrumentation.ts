import * as Sentry from '@sentry/nextjs';

// Ponto de entrada do Next para instrumentacao de servidor (#8). Carrega a
// config certa para o runtime, e entrega ao Sentry todo erro de request que o
// Next capturar — e isso que faz um 5xx virar alerta em vez de reclamacao.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

export const onRequestError = Sentry.captureRequestError;
