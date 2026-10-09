import 'server-only';

/**
 * Criacao do pedido (Issue #104).
 *
 * A entrada inteira do checkout passa por aqui, e o desenho e o mesmo do resto
 * da loja: o que o navegador manda sao ESCOLHAS, nunca valores.
 *
 *   entra:  { itens: [{ slug, tamanho, quantidade }], endereco: {...},
 *             servico: 'pac' | 'sedex', aceite: true }
 *   sai:    id e numero do pedido gravado
 *
 * Nao ha parametro de preco, de total, de frete nem de `user_id`. Um corpo com
 * `total: 1` nao e recusado — e simplesmente descartado pelo schema antes de
 * virar objeto, e o valor e recalculado do catalogo. (#19 e #99.)
 *
 * O frete segue a mesma regra (#199): entra o SERVICO, e o preco dele e cotado
 * aqui, para o CEP do endereco. Um `frete: 0` no corpo tambem e descartado.
 */

import { z } from 'zod';
import { clienteAdmin } from '@/lib/supabase/admin';
import { usuarioDaSessao } from '@/lib/supabase/servidor';
import { orcamento } from './catalogo';
import { esquemaEndereco, paraColunas } from './endereco';
import { esquemaServico, type MotivoDoFrete } from './frete';
import { esquemaCarrinho, type MotivoDaRecusa } from './precos';

/**
 * O aceite dos termos de compra (#276). `literal(true)`, e nao `boolean`: a
 * caixinha desmarcada nao e "false", e recusa. A acao do checkout confere o
 * mesmo schema antes, para dizer a pessoa o que faltou; aqui e a segunda vez,
 * ao lado da gravacao, porque quem chama `criaPedido` pode um dia nao ser o
 * checkout.
 */
export const esquemaAceiteDosTermos = z.literal(true);

/**
 * O contrato do checkout. `esquemaCarrinho` e `esquemaEndereco` ja sao os
 * mesmos usados no resto da loja — se divergissem, a tela aprovaria o que a
 * gravacao recusa.
 */
const esquemaCriacaoDePedido = z.object({
  itens: esquemaCarrinho.shape.itens,
  endereco: esquemaEndereco,
  servico: esquemaServico,
  aceite: esquemaAceiteDosTermos,
});

type MotivoDaCriacao =
  | MotivoDaRecusa
  | 'catalogo-indisponivel'
  | MotivoDoFrete
  | 'frete-servico-indisponivel'
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
  const { itens, endereco, servico } = entrada.data;
  const conta = await orcamento(itens, { cep: endereco.cep, servico });
  if (!conta.ok) return { ok: false, motivo: conta.motivo };

  // Com `entrega`, o orcamento so volta ok com frete. A pergunta fica aqui
  // assim mesmo: pedido sem frete nao pode sair desta funcao nem por engano.
  const { frete } = conta;
  if (!frete) return { ok: false, motivo: 'frete-sem-configuracao' };

  // Client com a chave secreta porque `authenticated` nao tem INSERT em
  // `orders` — de proposito, desde a #18: "o cliente le, o servidor escreve".
  const admin = clienteAdmin();

  // Uma transacao so. Pedido sem item nao chega a existir nem por um instante.
  const { data, error } = await admin.rpc('cria_pedido', {
    p_user_id: usuario.id,
    p_total_centavos: conta.totalCentavos,
    p_endereco: paraColunas(endereco),
    // Os nomes batem com as colunas de `order_items`. O snapshot da #18 e copia
    // direta do que o `orcamento` calculou.
    p_itens: conta.linhas.map((l) => ({
      produto_slug: l.produtoSlug,
      nome: l.nome,
      tamanho: l.tamanho,
      quantidade: l.quantidade,
      preco_unitario_centavos: l.precoUnitarioCentavos,
    })),
    // O frete cotado agora, nao o que a tela mostrou. Os dois so divergem se a
    // cotacao mudou, e entao vale a de agora.
    p_frete: {
      centavos: frete.precoCentavos,
      servico: frete.servico,
      prazo_dias: frete.prazoDias,
    },
    // A hora do aceite e a DESTE relogio, no instante em que o pedido nasce.
    // O corpo nao tem como trazer outra: o schema so conhece `aceite: true`,
    // e um `termos_aceitos_em` mandado pelo navegador foi descartado no parse.
    p_termos_aceitos_em: new Date().toISOString(),
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
