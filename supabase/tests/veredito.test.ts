import { describe, expect, it } from 'vitest';
import { reprovacoes } from './veredito.mjs';

/** Saidas no formato alinhado do psql, como o rodar.mjs as recebe. */
const TABELA_OK = ` res |            caso             | esperado | obtido
-----+-----------------------------+----------+--------
 ok  | intruso lista sessoes       | 0        | 0
 ok  | intruso encerra sessao alheia | false  | false
(2 rows)
`;

const VEREDITO_OK = `        proname         | seguranca | veredito
------------------------+-----------+----------
 conta_pedidos_por_status | INVOKER | OK
(1 row)
`;

describe('reprovacoes', () => {
  it('tabela toda ok passa, nos dois formatos dos arquivos', () => {
    expect(reprovacoes(TABELA_OK)).toEqual([]);
    expect(reprovacoes(VEREDITO_OK)).toEqual([]);
  });

  it('FALHA e FALHOU reprovam, com a linha do caso no motivo', () => {
    const falha = TABELA_OK.replace(' ok  | intruso lista', ' FALHA | intruso lista');
    expect(reprovacoes(falha)).toEqual([
      'caso reprovado: FALHA | intruso lista sessoes       | 0        | 0',
    ]);
    expect(reprovacoes(VEREDITO_OK.replace('| OK', '| FALHOU'))).toHaveLength(2);
  });

  it('o cabecalho "falhou" da contagem nao e falha', () => {
    const contagem = ` passou | falhou
--------+--------
      2 |      0
(1 row)
`;
    expect(reprovacoes(TABELA_OK + contagem)).toEqual([]);
  });

  it('consulta sem linha reprova: funcao renomeada nao passa em silencio', () => {
    const vazia = `${VEREDITO_OK} indexname | indexdef
-----------+----------
(0 rows)
`;
    expect(reprovacoes(vazia)).toEqual(['uma consulta nao devolveu linha nenhuma']);
  });

  it('saida sem veredito nenhum reprova', () => {
    expect(reprovacoes('DO\nBEGIN\nROLLBACK\n')).toEqual(['nenhum veredito ok na saida']);
  });
});
