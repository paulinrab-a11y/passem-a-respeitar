// O que conta como reprovado na saida do psql (#335).
//
// Os arquivos de supabase/tests foram escritos para colar no SQL Editor e ler
// o resultado com os olhos: cada um termina numa tabela com `ok`/`FALHA` ou
// `OK`/`FALHOU`. Aqui a mesma leitura vira regra, sem mudar os arquivos:
//
// - `FALHA` ou `FALHOU` em qualquer linha: um caso deu errado;
// - `(0 rows)`: uma consulta que devia achar a funcao, o indice ou os casos
//   nao achou nada. Sem isto, funcao renomeada passaria em silencio, porque a
//   linha com o veredito simplesmente nao existiria;
// - nenhum `ok`/`OK`: o arquivo nao mostrou veredito nenhum.
//
// Erro de SQL nao passa por aqui: o psql roda com ON_ERROR_STOP e sai com
// codigo diferente de zero.

/** @param {string} saida a saida do psql, no formato alinhado padrao */
export function reprovacoes(saida) {
  const motivos = [];
  const linhas = saida.split(/\r?\n/);

  for (const linha of linhas) {
    if (/\bFALH(A|OU)\b/.test(linha)) motivos.push(`caso reprovado: ${linha.trim()}`);
  }
  if (linhas.some((l) => l.trim() === '(0 rows)')) {
    motivos.push('uma consulta nao devolveu linha nenhuma');
  }
  if (!linhas.some((l) => /(^|\|)\s*(ok|OK)\s*(\||$)/.test(l))) {
    motivos.push('nenhum veredito ok na saida');
  }
  return motivos;
}
