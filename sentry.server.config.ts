import * as Sentry from '@sentry/nextjs';
import { opcoesComuns } from '@/lib/sentry/opcoes';

// Servidor Node (route handlers, server actions, Server Components). As
// opcoes vivem em lib/sentry/opcoes.ts; aqui so se inicia. (#8)
Sentry.init(opcoesComuns(process.env.NEXT_PUBLIC_SENTRY_DSN));
