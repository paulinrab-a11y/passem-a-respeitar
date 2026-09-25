import * as Sentry from '@sentry/nextjs';
import { opcoesComuns } from '@/lib/sentry/opcoes';

// Navegador. Sem Replay, de proposito: ele grava o DOM, e o DOM tem nome,
// endereco e o formulario de cartao por perto. Erro com stack basta. (#8)
//
// A DSN e publica por natureza (identifica o projeto, nao autoriza nada), e
// por isso pode ser NEXT_PUBLIC_. O envio vai pelo tunel do proprio site
// (`tunnelRoute` em next.config.mjs): sem host novo na CSP e sem bloqueador
// de anuncio no caminho.
Sentry.init(opcoesComuns(process.env.NEXT_PUBLIC_SENTRY_DSN));

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
