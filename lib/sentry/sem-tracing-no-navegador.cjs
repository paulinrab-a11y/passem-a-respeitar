/**
 * Loader do Turbopack que tira tracing e debug do Sentry do navegador (#360).
 *
 * O SDK marca esse codigo com `__SENTRY_TRACING__` e `__SENTRY_DEBUG__`. Com
 * as duas como `false`, o minificador corta os ramos e o tree shaking leva o
 * resto (browserTracingIntegration, spans, mensagens de debug).
 *
 * O `webpack.treeshake` do withSentryConfig faz isso so no webpack, e o build
 * e Turbopack. `compiler.define` do Next nao serve: vale para servidor e
 * navegador juntos, e o servidor continua com tracing. Por isso um loader,
 * aplicado so a codigo do navegador dentro de node_modules/@sentry
 * (condicao em next.config.mjs).
 *
 * A troca mantem o comprimento (`false` mais espacos) para o mapa de origem
 * que chega continuar valendo: nenhuma coluna anda.
 */

const MARCAS = /\b__SENTRY_(?:TRACING|DEBUG)__\b/g;

/** @param {string} fonte */
function troca(fonte) {
  return fonte.replace(MARCAS, (marca) => 'false'.padEnd(marca.length, ' '));
}

/**
 * @this {{ callback: (erro: null, fonte: string, mapa?: unknown) => void }}
 * @param {string} fonte
 * @param {unknown} [mapa]
 */
function loader(fonte, mapa) {
  this.callback(null, troca(fonte), mapa);
}

module.exports = loader;
module.exports.troca = troca;
