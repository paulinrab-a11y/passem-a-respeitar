import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // O tsconfig do Next usa jsx: 'preserve', que o Vite nao sabe transformar
  // sozinho. O plugin resolve, e e o caminho documentado para React + Vitest.
  plugins: [react()],
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
    // Valores falsos para os modulos que leem o ambiente no import. Sem eles,
    // qualquer teste que toque a arvore do Supabase morre no import com
    // "variavel nao definida" — que e o comportamento certo em producao e
    // atrapalhado aqui. Quem testa a falta da variavel usa vi.stubEnv('').
    env: {
      NEXT_PUBLIC_SUPABASE_URL: 'https://projeto-de-teste.supabase.co',
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_chave_de_teste',
    },
    include: ['lib/**/*.test.ts', 'app/**/*.test.{ts,tsx}', 'proxy.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      // So o que da para testar sem navegador e sem banco. app/_home e o script
      // legado portado verbatim e a pagina que o monta: quem cobre aquilo e o
      // Playwright (#10), nao teste de unidade.
      include: ['lib/**/*.ts', 'app/**/*.ts', 'proxy.ts'],
      exclude: ['**/*.test.{ts,tsx}', 'lib/supabase/tipos.ts', 'app/_home/**'],
      // Piso, nao meta. Existe para que uma queda apareca no PR, nao para
      // premiar numero alto: o que importa e o que esta coberto, e aqui e a
      // comparacao do convite e a assinatura do cookie.
      thresholds: { lines: 85, functions: 85, branches: 85, statements: 85 },
    },
  },
});
