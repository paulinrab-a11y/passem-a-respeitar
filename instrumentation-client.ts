import * as Sentry from '@sentry/nextjs';
import { opcoesDoNavegador } from '@/lib/sentry/navegador';

// Navegador. Sem Replay, de proposito: ele grava o DOM, e o DOM tem nome,
// endereco e o formulario de cartao por perto. Erro com stack basta. (#8)
//
// A DSN e publica por natureza (identifica o projeto, nao autoriza nada), e
// por isso pode ser NEXT_PUBLIC_. O envio vai pelo tunel do proprio site
// (`tunnelRoute` em next.config.mjs): sem host novo na CSP e sem bloqueador
// de anuncio no caminho.
//
// Sem tracing no navegador e sem embrulhar cada requestAnimationFrame da cena
// (#360): ver lib/sentry/navegador.ts.
Sentry.init(
  opcoesDoNavegador(process.env.NEXT_PUBLIC_SENTRY_DSN, Sentry.browserApiErrorsIntegration)
);

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
