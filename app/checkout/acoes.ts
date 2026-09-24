'use server';

import { redirect } from 'next/navigation';
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

  const cota = limita(`checkout:${usuario.id}`, LIMITE.maximo, LIMITE.janelaMs);
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

  // `redirect` lanca — por isso fica fora de try. O pedido ja existe neste
  // ponto; daqui em diante a tela de detalhe e a fonte de verdade.
  redirect(`/conta/pedidos/${criado.id}`);
}
