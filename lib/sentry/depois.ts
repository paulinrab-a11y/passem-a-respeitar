import 'server-only';

import * as Sentry from '@sentry/nextjs';
import { after } from 'next/server';

/**
 * Teto do envio ao Sentry. Corre depois da resposta, mas ainda dentro do
 * `maxDuration` da funcao: quem soma o orcamento de uma rota conta com ele.
 */
export const ESPERA_DO_ENVIO_MS = 2000;

/**
 * Manda ao Sentry o que ja foi capturado, sem segurar a resposta (#281).
 *
 * Funcao serverless congela assim que responde, e o SDK envia em segundo
 * plano: sem `flush`, o evento nao sai. Esperar o `flush` antes de responder
 * custava ate 2 s em cada resposta de erro — justamente as que ja chegam
 * atrasadas. `after` roda depois de a resposta sair, na mesma invocacao (na
 * Vercel, por `waitUntil`), e o evento continua chegando.
 *
 * Fora de um request (teste, script) `after` lanca. Ali nao ha resposta para
 * segurar nem funcao para congelar, e o envio sai direto.
 */
export function enviaDepois(): void {
  try {
    after(() => Sentry.flush(ESPERA_DO_ENVIO_MS));
  } catch {
    void Sentry.flush(ESPERA_DO_ENVIO_MS);
  }
}
