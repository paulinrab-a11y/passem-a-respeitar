import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['lib/**/*.test.ts', 'app/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      // So o que da para testar sem navegador e sem banco. app/_home e o script
      // legado portado verbatim e a pagina que o monta: quem cobre aquilo e o
      // Playwright (#10), nao teste de unidade.
      include: ['lib/**/*.ts'],
      exclude: ['lib/**/*.test.ts', 'lib/supabase/tipos.ts'],
      // Piso, nao meta. Existe para que uma queda apareca no PR, nao para
      // premiar numero alto: o que importa e o que esta coberto, e aqui e a
      // comparacao do convite e a assinatura do cookie.
      thresholds: { lines: 85, functions: 85, branches: 85, statements: 85 },
    },
  },
});
