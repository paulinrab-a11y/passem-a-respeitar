import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // Mesmo alias do tsconfig, para o teste importar como o codigo importa.
      '@': fileURLToPath(new URL('.', import.meta.url)),
      // `server-only` existe para explodir quando importado fora do servidor,
      // e e exatamente isso que ele faz aqui — o Vitest nao roda na condicao
      // `react-server`, entao pega a versao que lanca. A propria biblioteca
      // publica um `empty` para este caso.
      //
      // O que `server-only` protege continua protegido: quem garante que a
      // chave secreta nao vai para o navegador e o build do Next, e o teste
      // em fronteira.test.ts confere a mesma propriedade lendo o codigo.
      //
      // Caminho de arquivo, nao 'server-only/empty': o package.json so exporta
      // '.', entao o subpath nao resolve.
      'server-only': fileURLToPath(new URL('node_modules/server-only/empty.js', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['lib/**/*.test.ts', 'app/**/*.test.ts', 'middleware.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      // So o que da para testar sem navegador e sem banco. app/_home e o script
      // legado portado verbatim e a pagina que o monta: quem cobre aquilo e o
      // Playwright (#10), nao teste de unidade.
      include: ['lib/**/*.ts', 'middleware.ts'],
      exclude: ['lib/**/*.test.ts', 'lib/supabase/tipos.ts'],
      // Piso, nao meta. Existe para que uma queda apareca no PR, nao para
      // premiar numero alto: o que importa e o que esta coberto, e aqui e a
      // comparacao do convite e a assinatura do cookie.
      thresholds: { lines: 85, functions: 85, branches: 85, statements: 85 },
    },
  },
});
