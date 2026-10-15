'use server';

import { headers } from 'next/headers';
import { opcoesDeFrete } from '@/lib/loja/catalogo';
import { soDigitos } from '@/lib/loja/endereco';
import type { OpcaoDeFrete } from '@/lib/loja/frete';
import { esquemaItemDoCarrinho } from '@/lib/loja/precos';
import { RECADOS_DO_FRETE } from '@/lib/loja/recados-do-frete';
import { ipDoRequest, limita } from '@/lib/rate-limit';

/**
 * Frete na ficha da camiseta (Issue #205): o preco antes de qualquer
 * cadastro.
 *
 * Nao exige sessao, porque o ponto e justamente mostrar o frete a quem ainda
 * nao entrou. Em troca, o limite e por IP, e mais apertado que o do checkout:
 * cada consulta usa o token do Melhor Envio, e um script varrendo CEPs para
 * nas vinte. O cache da cotacao (30 min por CEP) e a outra barreira, e o
 * que vem dele nao conta no limite (#308).
 *
 * O que volta e para MOSTRAR. Nada daqui entra em pedido: o checkout cota de
 * novo, com sessao, e a criacao do pedido cota uma terceira vez.
 */

/** Vinte por IP a cada dez minutos. Quem digita o CEP errado duas vezes nem chega perto. */
const LIMITE = { maximo: 20, janelaMs: 10 * 60 * 1000 };

/**
 * Teto de qualquer chamada, venha do cache ou nao: o cache poupa o Melhor
 * Envio, mas cada chamada ainda le o catalogo no Supabase e o cache no
 * Upstash. Folgado para duas fichas na home e um CEP digitado de novo varias
 * vezes; apertado o bastante para um script repetindo o mesmo CEP parar.
 */
const LIMITE_TOTAL = { maximo: 120, janelaMs: 10 * 60 * 1000 };

export type FreteNaFicha = { ok: true; opcoes: OpcaoDeFrete[] } | { ok: false; texto: string };

export async function cotarFreteNaFicha(bruto: {
  slug: unknown;
  tamanho: unknown;
  cep: unknown;
}): Promise<FreteNaFicha> {
  const cep = typeof bruto.cep === 'string' ? soDigitos(bruto.cep) : '';
  if (!/^\d{8}$/.test(cep)) return { ok: false, texto: RECADOS_DO_FRETE['frete-cep-invalido'] };

  // Uma camiseta, do tamanho padrao da ficha. Peso e preco nao mudam com o
  // tamanho, entao o frete e o mesmo para qualquer um.
  const item = esquemaItemDoCarrinho.safeParse({
    slug: bruto.slug,
    tamanho: bruto.tamanho || null,
    quantidade: 1,
  });
  if (!item.success) return { ok: false, texto: RECADOS_DO_FRETE['frete-fora-do-ar'] };

  const ip = ipDoRequest(await headers());
  const total = await limita(`frete-ficha-total:${ip}`, LIMITE_TOTAL.maximo, LIMITE_TOTAL.janelaMs);
  if (!total.permitido) return { ok: false, texto: RECADOS_DO_FRETE['frete-limite'] };

  // A cota apertada so e descontada quando a consulta vai mesmo ao Melhor
  // Envio (#308): CEP que ja esta no cache, ou cuja cotacao ja esta no ar, nao
  // gasta uma das vinte.
  const descontaCota = async () =>
    (await limita(`frete-ficha:${ip}`, LIMITE.maximo, LIMITE.janelaMs)).permitido;

  const r = await opcoesDeFrete([item.data], cep, descontaCota);
  if (!r.ok) {
    return { ok: false, texto: RECADOS_DO_FRETE[r.motivo] ?? RECADOS_DO_FRETE['frete-fora-do-ar'] };
  }

  return { ok: true, opcoes: r.opcoes };
}
