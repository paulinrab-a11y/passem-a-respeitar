import * as Sentry from '@sentry/nextjs';
import { opcoesComuns } from '@/lib/sentry/opcoes';

// Edge runtime: o middleware. Mesmas opcoes do servidor. (#8)
Sentry.init(opcoesComuns(process.env.NEXT_PUBLIC_SENTRY_DSN));
