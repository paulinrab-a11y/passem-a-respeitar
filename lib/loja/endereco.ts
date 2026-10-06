/**
 * Endereco de entrega (Issue #102).
 *
 * Funcao pura. O que o navegador manda passa por aqui antes de virar coluna, e
 * o que sai daqui ja esta no formato que o banco aceita.
 *
 * A divisao entre o que o banco confere e o que este arquivo confere e
 * proposital:
 *
 *   banco  — FORMA. `entrega_cep ~ '^[0-9]{8}$'`, `entrega_uf ~ '^[A-Z]{2}$'`.
 *            Garante que nada quebra ao formatar, ordenar ou comparar, venha a
 *            escrita de onde vier.
 *   aqui   — VALIDADE. "SP" e estado, "XX" nao e.
 *
 * A lista de 27 siglas fica num lugar so, e e este. Repeti-la no check
 * constraint seria manter a mesma lista em duas linguagens para nada: quem
 * escreve endereco e sempre esta camada.
 */

import { z } from 'zod';

/** As 26 unidades federativas mais o Distrito Federal. */
const UFS = [
  'AC',
  'AL',
  'AP',
  'AM',
  'BA',
  'CE',
  'DF',
  'ES',
  'GO',
  'MA',
  'MT',
  'MS',
  'MG',
  'PA',
  'PB',
  'PR',
  'PE',
  'PI',
  'RJ',
  'RN',
  'RS',
  'RO',
  'RR',
  'SC',
  'SP',
  'SE',
  'TO',
] as const;

/** "SP" e estado, "XX" nao e. Quem pergunta e a busca pelo CEP (#204). */
export function ehUf(valor: string): valor is (typeof UFS)[number] {
  return (UFS as readonly string[]).includes(valor);
}

/**
 * `01310-100`, `01310 100` e `01310100` sao o mesmo CEP. O banco guarda so
 * digitos para nao precisar decidir isso de novo em cada consulta.
 */
export function soDigitos(bruto: string): string {
  return bruto.replace(/\D/g, '');
}

/** `01310100` vira `01310-100`, para a tela. */
export function cepLegivel(cep: string): string {
  return /^\d{8}$/.test(cep) ? `${cep.slice(0, 5)}-${cep.slice(5)}` : cep;
}

/**
 * O que o checkout aceita.
 *
 * Nao ha CPF nem telefone. CPF e dado do pagador, pedido pelo provedor na hora
 * de cobrar, e nao precisa ficar guardado no pedido. Telefone ja esta em
 * `profiles`. Os limites batem com os check constraints da migration
 * 20260924140000 — se divergissem, o formulario diria que esta tudo certo e o
 * banco recusaria depois.
 */
export const esquemaEndereco = z.object({
  // Destinatario, que pode nao ser o titular da conta: presente, casa de outra
  // pessoa, portaria do trabalho.
  nome: z.string().trim().min(2).max(120),

  cep: z
    .string()
    .transform(soDigitos)
    .pipe(z.string().regex(/^\d{8}$/, 'CEP precisa ter 8 dígitos')),

  logradouro: z.string().trim().min(2).max(160),
  numero: z.string().trim().min(1).max(20),

  // Vazio e ausente sao a mesma coisa aqui, e viram null — a coluna e nullable
  // e string vazia no banco seria um terceiro estado sem significado.
  complemento: z
    .string()
    .trim()
    .max(80)
    .nullish()
    .transform((v) => v || null),

  bairro: z.string().trim().min(2).max(80),
  cidade: z.string().trim().min(2).max(80),

  uf: z
    .string()
    .trim()
    .toUpperCase()
    .pipe(z.enum(UFS, { message: 'UF inválida' })),
});

export type Endereco = z.infer<typeof esquemaEndereco>;

/** Nomes de coluna de `orders`. A criacao do pedido grava isto direto. */
export type EnderecoNoPedido = {
  entrega_nome: string;
  entrega_cep: string;
  entrega_logradouro: string;
  entrega_numero: string;
  entrega_complemento: string | null;
  entrega_bairro: string;
  entrega_cidade: string;
  entrega_uf: string;
};

export function paraColunas(endereco: Endereco): EnderecoNoPedido {
  return {
    entrega_nome: endereco.nome,
    entrega_cep: endereco.cep,
    entrega_logradouro: endereco.logradouro,
    entrega_numero: endereco.numero,
    entrega_complemento: endereco.complemento,
    entrega_bairro: endereco.bairro,
    entrega_cidade: endereco.cidade,
    entrega_uf: endereco.uf,
  };
}

/** Uma linha, para o resumo do checkout e o detalhe do pedido. */
export function enderecoEmUmaLinha(e: EnderecoNoPedido): string {
  const complemento = e.entrega_complemento ? `, ${e.entrega_complemento}` : '';
  return (
    `${e.entrega_logradouro}, ${e.entrega_numero}${complemento} — ` +
    `${e.entrega_bairro}, ${e.entrega_cidade}/${e.entrega_uf} — ${cepLegivel(e.entrega_cep)}`
  );
}
