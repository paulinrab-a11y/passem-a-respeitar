'use server';

import { opcoesDeFrete } from '@/lib/loja/catalogo';
import { esquemaEndereco, soDigitos } from '@/lib/loja/endereco';
import { buscaEnderecoPeloCep, type EnderecoPeloCep } from '@/lib/loja/endereco-por-cep';
import type { OpcaoDeFrete } from '@/lib/loja/frete';
import { criaPedido } from '@/lib/loja/pedido';
import { esquemaItemDoCarrinho } from '@/lib/loja/precos';
import { limita } from '@/lib/rate-limit';
import { usuarioDaSessao } from '@/lib/supabase/servidor';
import type { EstadoDoCheckout } from './estado';

/** Dez por hora. O alvo e script criando pedido em sequencia, nao quem erra o CEP. */
const LIMITE = { maximo: 10, janelaMs: 60 * 60 * 1000 };

/**
 * Cotacoes de frete por pessoa (#199). Cada uma e uma chamada ao Melhor
 * Envio, com o token do dono: quem digita o CEP de novo nao chega perto disto,
 * e um script que varre CEPs para nas trinta.
 */
const LIMITE_DO_FRETE = { maximo: 30, janelaMs: 10 * 60 * 1000 };

/** Buscas de endereco por pessoa (#204). O ViaCEP e gratuito e de todos; nao se abusa. */
const LIMITE_DO_ENDERECO = { maximo: 30, janelaMs: 10 * 60 * 1000 };

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
  // Frete (#199). Nenhuma delas diz qual configuracao falta: isso e do log.
  'frete-cep-invalido': 'Confira o CEP: não encontrei esse endereço.',
  'frete-sem-servico': 'Os Correios não entregam nesse CEP por PAC nem por SEDEX.',
  'frete-servico-indisponivel': 'Esse tipo de envio não atende esse CEP. Escolha o outro.',
  'frete-fora-do-ar': 'Não consegui calcular o frete agora. Tente de novo em instantes.',
  'frete-sem-configuracao': 'O frete está indisponível no momento. Tente de novo mais tarde.',
  'frete-sem-medida': 'O frete está indisponível no momento. Tente de novo mais tarde.',
  'nao-consegui-gravar': 'Não consegui criar o pedido agora. Tente de novo.',
  'frete-escolha': 'Escolha PAC ou SEDEX.',
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

  // A escolha do servico, e so ela. O preco do frete e cotado de novo dentro
  // de `criaPedido`: o que a tela mostrou nao entra no total.
  const servico = form.get('servico');
  if (servico !== 'pac' && servico !== 'sedex') {
    return erro('frete-escolha', 'servico');
  }

  const criado = await criaPedido({ itens: [item.data], endereco: endereco.data, servico });
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

export type RespostaDoFrete =
  | { ok: true; subtotalCentavos: number; opcoes: OpcaoDeFrete[] }
  | { ok: false; texto: string };

/**
 * PAC e SEDEX para o CEP que a pessoa digitou (#199).
 *
 * Chamada pelo formulario quando o CEP fica completo. O que volta e para
 * MOSTRAR: o pedido cota de novo quando e criado, e e aquela cotacao que
 * entra no total.
 *
 * Mesmas barreiras do resto do checkout: sessao, item validado pelo schema,
 * preco lido do catalogo. E um limite proprio, porque cada chamada gasta uma
 * consulta ao Melhor Envio.
 */
export async function cotarFrete(bruto: {
  slug: unknown;
  tamanho: unknown;
  quantidade: unknown;
  cep: unknown;
}): Promise<RespostaDoFrete> {
  const usuario = await usuarioDaSessao();
  if (!usuario) return { ok: false, texto: RECADOS['sem-sessao'] };

  const cep = typeof bruto.cep === 'string' ? soDigitos(bruto.cep) : '';
  if (!/^\d{8}$/.test(cep)) return { ok: false, texto: RECADOS['frete-cep-invalido'] };

  const item = esquemaItemDoCarrinho.safeParse({
    slug: bruto.slug,
    tamanho: bruto.tamanho || null,
    quantidade: Number(bruto.quantidade ?? 1),
  });
  if (!item.success) return { ok: false, texto: RECADOS['produto-indisponivel'] };

  const cota = await limita(
    `frete:${usuario.id}`,
    LIMITE_DO_FRETE.maximo,
    LIMITE_DO_FRETE.janelaMs
  );
  if (!cota.permitido) {
    return { ok: false, texto: 'Muitas consultas de frete. Tente de novo em alguns minutos.' };
  }

  const r = await opcoesDeFrete([item.data], cep);
  if (!r.ok) return { ok: false, texto: RECADOS[r.motivo] ?? RECADOS['frete-fora-do-ar'] };

  return { ok: true, subtotalCentavos: r.subtotalCentavos, opcoes: r.opcoes };
}

/**
 * Rua, bairro, cidade e UF do CEP que a pessoa digitou (#204).
 *
 * Volta `null` em toda falha, de proposito: sem resposta a pessoa digita o
 * endereco, como fazia antes. Nao ha mensagem de erro para "o ViaCEP nao
 * conhece esse CEP" — o CEP pode estar certo e ser novo, e quem decide e o
 * envio do formulario, validado pelo `esquemaEndereco`.
 *
 * Com sessao e com limite, como a cotacao: e uma chamada para fora.
 */
export async function buscarEndereco(bruto: unknown): Promise<EnderecoPeloCep | null> {
  const usuario = await usuarioDaSessao();
  if (!usuario) return null;

  const cep = typeof bruto === 'string' ? soDigitos(bruto) : '';
  if (!/^\d{8}$/.test(cep)) return null;

  const cota = await limita(
    `endereco:${usuario.id}`,
    LIMITE_DO_ENDERECO.maximo,
    LIMITE_DO_ENDERECO.janelaMs
  );
  if (!cota.permitido) return null;

  const r = await buscaEnderecoPeloCep(cep);
  return r.ok ? r.endereco : null;
}
