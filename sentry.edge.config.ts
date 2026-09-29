import * as Sentry from '@sentry/nextjs';
import { opcoesComuns } from '@/lib/sentry/opcoes';

// Edge runtime. Mesmas opcoes do servidor. (#8)
//
// Ate o Next 15 era aqui que o middleware rodava. O `proxy.ts` do Next 16 roda
// em Node e usa a config de servidor (#180). Este arquivo fica para o dia em
// que alguma rota declarar `runtime = 'edge'`: sem ele, erro la nao chegaria
// ao Sentry.
Sentry.init(opcoesComuns(process.env.NEXT_PUBLIC_SENTRY_DSN));
