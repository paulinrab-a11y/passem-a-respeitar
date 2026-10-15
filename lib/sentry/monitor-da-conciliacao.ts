import type { captureCheckIn } from '@sentry/nextjs';

/** O SDK nao exporta o tipo pelo nome; vem da propria funcao. */
type MonitorConfig = NonNullable<Parameters<typeof captureCheckIn>[1]>;

/**
 * Monitor de cron do Sentry (#273). Avisa o que o log nao avisa: o cron que
 * NAO rodou (CRON_SECRET apagado, cron desligado no painel, deploy quebrado).
 *
 * `schedule` repete o de `vercel.json` (um teste confere). `checkinMargin` de
 * 60 min porque o plano Hobby da Vercel dispara o cron diario em qualquer
 * minuto da hora marcada, nao no minuto exato. `maxRuntime` folgado: a funcao
 * para muito antes disso, e o que importa e o check-in nao ficar pendurado.
 * O cron da Vercel roda em UTC.
 */
export const MONITOR: { slug: string; config: MonitorConfig } = {
  slug: 'cron-conciliacao',
  config: {
    schedule: { type: 'crontab', value: '0 3 * * *' },
    checkinMargin: 60,
    maxRuntime: 10,
    timezone: 'Etc/UTC',
  },
};
