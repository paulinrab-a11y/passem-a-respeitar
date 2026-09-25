'use server';

import { esquemaEndereco } from '@/lib/loja/endereco';
import { criaPedido } from '@/lib/loja/pedido';
import { esquemaItemDoCarrinho } from '@/lib/loja/precos';
import { limita } from '@/lib/rate-limit';
import { usuarioDaSessao } from '@/lib/supabase/servidor';
import type { EstadoDoCheckout } from './estado';

/** Dez por hora. O alvo e script criando pedido em sequencia, nao quem erra o CEP. */
const LIMITE = { maximo: 10, janelaMs: 60 * 60 * 1000 };

/** Mensagem por motivo. Nenhuma delas conta o que o catalogo tem. */
const RECADOS: Record<string, string> = {
  'entrada-invalida': 'Confira os dados de entrega.',
  'sem-sessao': 'Sua sessão expirou. Entre de novo.',
  'email-nao-verificado':
    'Confirme seu e-mail antes de comprar — é por ele que avisamos do pedido. O link está na sua caixa de entrada, ou reenvie em Conta.',
  'produto-indisponivel': 'Esse produto não está disponível agora.',
  'quantidade-invalida': 'Quantidade inválida.',
  'carrinho-vazio': 'Escolha um produto antes de finalizar.',
  'carrinho-grande-demais': 'Pedido grande demais.',
  'valor-alto-demais': 'Pedido grande demais.',
  'catalogo-indisponivel': 'Não consegui consultar o catálogo agora.',
  'nao-consegui-gravar': 'Não consegui criar o pedido agora. Tente de novo.',
};

function erro(motivo: string, campo: string | null = null): EstadoDoCheckout {
  return {
    recado: { tom: 'erro', texto: RECADOS[motivo] ?? RECADOS['nao-consegui-gravar'] },
    campo,
  };
}

export async function finalizarCompra(
  _anterior: EstadoDoCheckout,
  form: FormData
): Promise<EstadoDoCheckout> {
  const usuario = await usuarioDaSessao();
  if (!usuario) return erro('sem-sessao');

  // O "acesso limitado" da conta nao verificada (#30): olhar pedidos pode,
  // criar nao. Sem e-mail confirmado nao ha como avisar de nada — e e o
  // e-mail que o Mercado Pago recebe como pagador.
  if (!usuario.email_confirmed_at) return erro('email-nao-verificado');

  const cota = await limita(`checkout:${usuario.id}`, LIMITE.maximo, LIMITE.janelaMs);
  if (!cota.permitido) {
    return { recado: { tom: 'erro', texto: 'Muitas tentativas. Tente de novo mais tarde.' } };
  }

  // O item vem dos campos ocultos, que vieram da URL. Sao ESCOLHAS: o preco
  // e recalculado do catalogo dentro de `criaPedido`. Um campo oculto
  // adulterado no DevTools muda o que se compra, nunca quanto custa.
  const item = esquemaItemDoCarrinho.safeParse({
    slug: form.get('slug'),
    tamanho: form.get('tamanho') || null,
    quantidade: Number(form.get('quantidade') ?? 1),
  });
  if (!item.success) return erro('produto-indisponivel');

  const endereco = esquemaEndereco.safeParse({
    nome: form.get('nome'),
    cep: form.get('cep'),
    logradouro: form.get('logradouro'),
    numero: form.get('numero'),
    complemento: form.get('complemento'),
    bairro: form.get('bairro'),
    cidade: form.get('cidade'),
    uf: form.get('uf'),
  });

  if (!endereco.success) {
    // O primeiro campo que errou, para a tela focar nele em vez de a pessoa
    // caçar qual dos oito esta errado.
    const campo = String(endereco.error.issues[0]?.path[0] ?? '');
    return erro('entrada-invalida', campo || null);
  }

  const criado = await criaPedido({ itens: [item.data], endereco: endereco.data });
  if (!criado.ok) return erro(criado.motivo);

  // Para o PAGAMENTO, nao para o detalhe (#113): o pedido nasce
  // `aguardando_pagamento`, e mandar a pessoa para uma tela que so descreve o
  // pedido deixava a tela de pagar sem nenhum caminho ate ela.
  //
  // E NAO com `redirect()`: em server action ele e navegacao suave, e a tela
  // de pagamento chegaria sem a propria CSP — o Brick nao monta. Quem navega e
  // o cliente, com carregamento completo. (#118)
  return { recado: null, campo: null, irPara: `/checkout/pagamento/${criado.id}` };
}
