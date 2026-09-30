// Sobe o site para a suite de ponta a ponta (Issue #10).
//
// Build de producao e `next start`, que e o que a issue pede: o que se testa e
// o que vai para o ar, com CSP de producao, cookie `Secure` e sem o modo de
// desenvolvimento perdoando erro.
//
// O build acontece aqui, e nao se aproveita um `.next` que ja exista. As
// variaveis `NEXT_PUBLIC_*` sao escritas dentro do build: um `.next` feito com
// o endereco de producao continuaria apontando para producao, nao importa o
// que este arquivo dissesse depois.

import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { ADMIN, ambienteLocal, SITE } from './ambiente.mjs';

const local = ambienteLocal();
const next = createRequire(import.meta.url).resolve('next/dist/bin/next');

/**
 * Tudo que o site sabe ler, vazio.
 *
 * O Next carrega `.env.local` sozinho, e na maquina de quem desenvolve esse
 * arquivo tem as credenciais de verdade. Variavel ja definida no ambiente nao
 * e sobrescrita pelo arquivo, nem quando esta vazia — entao definir vazia e o
 * que impede a suite de falar com Redis, Sentry ou Mercado Pago de verdade.
 */
const DESLIGADAS = [
  'CONVITE_CODIGOS_HASH',
  'CONVITE_COOKIE_SECRET',
  'CONVITE_TEASER_EMBED',
  'CRON_SECRET',
  'MERCADOPAGO_ACCESS_TOKEN',
  'MERCADOPAGO_WEBHOOK_SECRET',
  'MERCADOPAGO_WEBHOOK_SECRET_ALT',
  'NEXT_PUBLIC_MERCADOPAGO_PUBLIC_KEY',
  'NEXT_PUBLIC_SENTRY_DSN',
  'SENTRY_AUTH_TOKEN',
  'SENTRY_ORG',
  'SENTRY_PROJECT',
  'SMTP_FROM',
  'SMTP_HOST',
  'SMTP_PASSWORD',
  'SMTP_PORT',
  'SMTP_USER',
  'UPSTASH_REDIS_REST_TOKEN',
  'UPSTASH_REDIS_REST_URL',
  // Na Vercel estas duas redirecionam para o host de producao (#141).
  'VERCEL_ENV',
  'VERCEL_PROJECT_PRODUCTION_URL',
];

/**
 * Protecao contra bot (#28), com as chaves de TESTE que a Cloudflare publica na
 * documentacao. Nao sao segredo, e nao protegem nada: o widget sempre passa, e
 * a conferencia aceita qualquer token. Servem para a suite exercitar o
 * caminho inteiro (script, iframe, CSP, campo, conferencia no servidor) sem
 * depender de resolver desafio.
 *
 * Em producao o site recusa estas chaves: ver lib/robo.ts.
 */
const DESAFIO_DE_TESTE = {
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
  TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA',
};

const env = { ...process.env };
for (const nome of DESLIGADAS) env[nome] = '';
// Quem decide e o Next: `production` no build e no start.
delete env.NODE_ENV;

Object.assign(env, {
  NEXT_PUBLIC_SITE_URL: SITE,
  NEXT_PUBLIC_SUPABASE_URL: local.supabase,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: local.chavePublica,
  SUPABASE_SECRET_KEY: local.chaveSecreta,
  // Definida, e nao herdada: o administrador de verdade, que esta no
  // `.env.local` de quem desenvolve, nao administra o banco de teste.
  ADMIN_EMAILS: ADMIN,
  NEXT_TELEMETRY_DISABLED: '1',
  ...DESAFIO_DE_TESTE,
});

const build = spawnSync(process.execPath, [next, 'build'], { env, stdio: 'inherit' });
if (build.status !== 0) process.exit(build.status ?? 1);

const { hostname, port } = new URL(SITE);
const site = spawn(process.execPath, [next, 'start', '-H', hostname, '-p', port], {
  env,
  stdio: 'inherit',
});

for (const sinal of ['SIGINT', 'SIGTERM']) {
  process.on(sinal, () => site.kill(sinal));
}
site.on('exit', (codigo) => process.exit(codigo ?? 0));
