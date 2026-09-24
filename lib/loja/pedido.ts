import 'server-only';

/**
 * Criacao do pedido (Issue #104).
 *
 * A entrada inteira do checkout passa por aqui, e o desenho e o mesmo do resto
 * da loja: o que o navegador manda sao ESCOLHAS, nunca valores.
 *
 *   entra:  { itens: [{ slug, tamanho, quantidade }], endereco: {...} }
 *   sai:    id e numero do pedido gravado
 *
 * Nao ha parametro de preco, de total, de frete nem de `user_id`. Um corpo com
 * `total: 1` nao e recusado — e simplesmente descartado pelo schema antes de
 * virar objeto, e o valor e recalculado do catalogo. (#19 e #99.)
 */

import { z } from 'zod';
import { clienteAdmin } from '@/lib/supabase/admin';
import { usuarioDaSessao } from '@/lib/supabase/servidor';
import { orcamento } from './catalogo';
import { esquemaEndereco, paraColunas } from './endereco';
import { esquemaCarrinho, type MotivoDaRecusa } from './precos';

/**
 * O contrato do checkout. `esquemaCarrinho` e `esquemaEndereco` ja sao os
 * mesmos usados no resto da loja — se divergissem, a tela aprovaria o que a
 * gravacao recusa.
 */
const esquemaCriacaoDePedido = z.object({
  itens: esquemaCarrinho.shape.itens,
  endereco: esquemaEndereco,
});

type MotivoDaCriacao =
  | MotivoDaRecusa
  | 'catalogo-indisponivel'
  | 'entrada-invalida'
  | 'sem-sessao'
  | 'nao-consegui-gravar';

export type CriacaoDePedido =
  | { ok: true; id: string; numero: number; totalCentavos: number }
  | { ok: false; motivo: MotivoDaCriacao };

type LinhaCriada = { pedido_id: string; pedido_numero: number };

/**
 * Cria o pedido do usuario da sessao.
 *
 * `bruto` e `unknown` de proposito: quem chama entrega o corpo do request como
 * veio, e a validacao acontece AQUI, ao lado da gravacao. Validar no chamador
 * deixaria a garantia a uma camada de distancia do lugar onde ela importa.
 */
export async function criaPedido(bruto: unknown): Promise<CriacaoDePedido> {
  const entrada = esquemaCriacaoDePedido.safeParse(bruto);
  if (!entrada.success) return { ok: false, motivo: 'entrada-invalida' };

  // Da SESSAO, nunca do corpo. Um `user_id` no request nem chega aqui: o
  // schema nao o declara, entao o parse o descartou.
  const usuario = await usuarioDaSessao();
  if (!usuario) return { ok: false, motivo: 'sem-sessao' };

  // O preco vem do banco. Esta e a unica origem de valor no caminho inteiro.
  const conta = await orcamento(entrada.data.itens, entrada.data.endereco.cep);
  if (!conta.ok) return { ok: false, motivo: conta.motivo };

  // Client com a chave secreta porque `authenticated` nao tem INSERT em
  // `orders` — de proposito, desde a #18: "o cliente le, o servidor escreve".
  const admin = clienteAdmin();

  // Uma transacao so. Pedido sem item nao chega a existir nem por um instante.
  const { data, error } = await admin.rpc('cria_pedido', {
    p_user_id: usuario.id,
    p_total_centavos: conta.totalCentavos,
    p_endereco: paraColunas(entrada.data.endereco),
    // Os nomes batem com as colunas de `order_items`. O snapshot da #18 e copia
    // direta do que o `orcamento` calculou.
    p_itens: conta.linhas.map((l) => ({
      produto_slug: l.produtoSlug,
      nome: l.nome,
      tamanho: l.tamanho,
      quantidade: l.quantidade,
      preco_unitario_centavos: l.precoUnitarioCentavos,
    })),
  });

  const criado = (data as LinhaCriada[] | null)?.[0];
  if (error || !criado) return { ok: false, motivo: 'nao-consegui-gravar' };

  return {
    ok: true,
    id: criado.pedido_id,
    numero: criado.pedido_numero,
    totalCentavos: conta.totalCentavos,
  };
}
