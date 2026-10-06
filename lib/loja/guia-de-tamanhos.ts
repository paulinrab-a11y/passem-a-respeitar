import { z } from 'zod';

/**
 * O guia de tamanhos de um produto (Issue #206), como vem do banco.
 *
 * Funcao pura, sem Supabase: o banco guarda JSON, e JSON de coluna e dado
 * como qualquer outro — passa por schema antes de virar tabela na tela. Uma
 * linha torta derruba o guia inteiro (`null`), e a tela nao mostra o link:
 * guia pela metade ensina errado.
 */

const esquemaDaLinha = z.object({
  tamanho: z.string().trim().min(1).max(4),
  /** Centimetros, inteiros. Nenhuma camiseta tem 3 cm nem 300. */
  altura: z.number().int().min(10).max(200),
  largura: z.number().int().min(10).max(200),
  manga: z.number().int().min(1).max(100),
});

const esquemaDoGuia = z.array(esquemaDaLinha).min(1).max(12);

export type LinhaDoGuia = z.infer<typeof esquemaDaLinha>;

export function leGuia(bruto: unknown): LinhaDoGuia[] | null {
  const parse = esquemaDoGuia.safeParse(bruto);
  return parse.success ? parse.data : null;
}
