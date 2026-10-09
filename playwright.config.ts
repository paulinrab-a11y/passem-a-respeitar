import { defineConfig, devices } from '@playwright/test';
import { SITE } from './e2e/apoio/ambiente.mjs';

/**
 * Testes de ponta a ponta (Issue #10).
 *
 * Rodam contra o build de producao do site, falando com o Supabase LOCAL.
 * Producao nao entra nesta historia em nenhum momento: `ambienteLocal()`
 * recusa qualquer endereco que nao seja desta maquina. Quem chama e o servidor
 * de teste, antes do build, e o `globalSetup`, antes do primeiro teste.
 *
 * Aqui nao: este arquivo tambem e lido por quem so quer saber quais sao os
 * arquivos de teste — o Knip, no job de lint —, e ler a configuracao nao pode
 * exigir um banco no ar.
 */

const noCI = Boolean(process.env.CI);

/** Os dominios do Mercado Pago e do Mercado Livre, sem endereco nenhum. */
const SEM_MERCADO_PAGO = [
  'mercadopago.com',
  'mercadopago.com.br',
  'mercadolibre.com',
  'mercadolivre.com',
  'mercadolivre.com.br',
  'mlstatic.com',
]
  .map((dominio) => `MAP *${dominio} ~NOTFOUND`)
  .join(', ');

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/apoio/antes.ts',
  globalTeardown: './e2e/apoio/depois.ts',

  // Um worker, em ordem. Os limites de tentativa do site sao por IP e ficam
  // na memoria do servidor: a suite inteira e UM visitante, e em paralelo os
  // testes disputariam a mesma cota e a mesma caixa de e-mail.
  workers: 1,
  fullyParallel: false,

  // `test.only` esquecido deixaria o CI verde rodando um teste so.
  forbidOnly: noCI,
  retries: noCI ? 1 : 0,
  reporter: noCI ? [['github'], ['html', { open: 'never' }]] : [['list']],

  timeout: 30_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: SITE,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  // So Chromium. O cookie de sessao e `Secure`, e em http so o Chromium e o
  // Firefox aceitam cookie `Secure` vindo de localhost; o WebKit recusa, e o
  // login local nunca funcionaria nele.
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // A suite tem chave publica do Mercado Pago (#274), entao toda tela de
        // pagamento tenta carregar o SDK deles — e o SDK, com uma chave que
        // nao existe, chamaria api.mercadopago.com. Para o Chromium da suite
        // esses hosts nao tem endereco: nada sai daqui para o Mercado Pago, em
        // nenhum arquivo de teste. Quem precisa do formulario poe um falso no
        // lugar (apoio/brick-falso.ts), antes de a rede ser consultada.
        launchOptions: { args: [`--host-resolver-rules=${SEM_MERCADO_PAGO}`] },
      },
    },
  ],

  webServer: {
    command: 'node e2e/apoio/servidor.mjs',
    url: `${SITE}/entrar`,
    // Build de producao mais a subida. No CI, em maquina fria, passa de dois
    // minutos.
    timeout: 6 * 60_000,
    // Sempre um servidor novo: os limites de tentativa moram na memoria dele,
    // e um servidor herdado traria a cota gasta pela rodada anterior. E um
    // `next dev` ocupando a porta nao e o que a issue manda testar.
    reuseExistingServer: false,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
