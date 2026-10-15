/**
 * A planilha de pedidos do dono (Issue #345).
 *
 * So funcao pura, como painel.ts: a rota le o banco e confere o papel; aqui
 * mora o que daria errado em silencio — uma celula que o Excel executa, uma
 * aspa que quebra a linha, um acento que vira lixo.
 *
 * O perigo de verdade e o primeiro: nome, rua e complemento sao digitados
 * pelo comprador. Um "=HYPERLINK(...)" no complemento vira formula quando o
 * dono abre o arquivo, e formula em planilha busca URL, le outra celula, roda
 * comando em Excel antigo. E o "CSV injection" da OWASP, e a defesa e a dela:
 * celula que comeca com `=`, `+`, `-`, `@`, tab ou CR ganha um `'` na frente,
 * que a planilha mostra como texto.
 */

import { formataParaPlanilha } from '@/lib/datas';
import { type LinhaComEntrega, leEntrega, leFrete, leStatus, reais } from './pedidos';

/**
 * Ponto e virgula, e nao virgula: o Excel em portugues abre `;` em colunas e
 * `,` numa coluna so — e o dinheiro aqui ja usa virgula no decimal. O Google
 * Planilhas detecta os dois.
 */
const SEPARADOR = ';';

/**
 * BOM no comeco: sem ele o Excel le o arquivo como Windows-1252, e "São
 * Paulo" vira "SÃ£o Paulo". O Planilhas ignora.
 */
const BOM = '﻿';

/** O que a planilha nunca pode ler como formula (OWASP, CSV Injection). */
const INICIO_PERIGOSO = /^[=+\-@\t\r]/;

/**
 * Uma celula pronta: neutralizada e entre aspas.
 *
 * Aspas sempre, e nao so quando precisa: decidir "precisa" e mais um `if`
 * para errar, e o arquivo e lido por gente, nao por diff. Aspa dentro do texto
 * dobra (RFC 4180). Quebra de linha fica dentro das aspas, onde e permitida.
 */
export function celula(valor: string | number | null | undefined): string {
  const texto = valor === null || valor === undefined ? '' : String(valor);
  const seguro = INICIO_PERIGOSO.test(texto) ? `'${texto}` : texto;
  return `"${seguro.replace(/"/g, '""')}"`;
}

function linha(celulas: (string | number | null)[]): string {
  return celulas.map(celula).join(SEPARADOR);
}

/** Na ordem das colunas da planilha. */
export const CABECALHO = [
  'Número',
  'Data',
  'Nome',
  'Endereço',
  'Tamanho',
  'Quantidade',
  'Frete',
  'Total',
  'Status',
] as const;

export type LinhaParaExportar = LinhaComEntrega & {
  numero: number;
  criado_em: string;
  status: string;
  total_centavos: number;
  frete_centavos: number;
  frete_servico: string | null;
  frete_prazo_dias: number | null;
  order_items: { nome: string; tamanho: string | null; quantidade: number }[];
};

/** Data ilegivel sai vazia, em vez de `RangeError` derrubar a planilha inteira. */
function data(iso: string): string {
  return Number.isFinite(Date.parse(iso)) ? formataParaPlanilha(iso) : '';
}

/**
 * Tamanho e quantidade de um pedido de uma linha so. A loja tem uma peca, e
 * quase todo pedido tem um item; com mais de um, cada tamanho leva a
 * quantidade dele ("M (2), G (1)") e a coluna Quantidade soma.
 */
function tamanhos(itens: LinhaParaExportar['order_items']): string {
  if (itens.length === 1) return itens[0].tamanho ?? '';
  return itens.map((i) => `${i.tamanho ?? 'único'} (${i.quantidade})`).join(', ');
}

/**
 * Uma linha por pedido, com o endereco como vai para a etiqueta. Pedido
 * anonimizado (conta excluida) sai sem nome e sem endereco — `leEntrega` ja
 * devolve nulo — e continua na planilha: o numero, o valor e o status sao da
 * loja, e o dono precisa deles para fechar as contas.
 */
export function csvDePedidos(pedidos: LinhaParaExportar[]): string {
  const linhas = pedidos.map((p) => {
    const entrega = leEntrega(p);
    const frete = leFrete(p.frete_servico, p.frete_centavos, p.frete_prazo_dias);
    const complemento = entrega?.complemento ? `, ${entrega.complemento}` : '';

    return linha([
      p.numero,
      data(p.criado_em),
      entrega?.nome ?? '',
      entrega
        ? `${entrega.logradouro}, ${entrega.numero}${complemento} — ${entrega.bairro}, ${entrega.cidade}/${entrega.uf} — CEP ${entrega.cep}`
        : '',
      tamanhos(p.order_items),
      p.order_items.reduce((soma, i) => soma + i.quantidade, 0),
      frete ? `${frete.servico} ${frete.valor}` : '',
      reais(p.total_centavos),
      leStatus(p.status).rotulo,
    ]);
  });

  // CRLF, como pede a RFC 4180 e como o Excel escreve.
  return BOM + [linha([...CABECALHO]), ...linhas].join('\r\n');
}

/** `pedidos-2026-10-15.csv`: o dia, no fuso da loja, para nao sobrescrever o de ontem. */
export function nomeDoArquivo(agora = new Date()): string {
  return `pedidos-${data(agora.toISOString()).slice(0, 10)}.csv`;
}
