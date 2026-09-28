import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { ambienteLocal } from './ambiente.mjs';

/**
 * Acesso direto ao banco LOCAL, para montar o cenario de cada teste.
 *
 * O que se testa pelo navegador e o site. Usuario confirmado e pedido pronto
 * sao cenario, nao assunto: criar pela tela custaria um cadastro e um e-mail
 * por teste, e o limite de cadastro por IP acabaria antes da suite.
 *
 * Nada aqui tem credencial escrita. Senha e e-mail nascem de bytes aleatorios
 * a cada rodada, e a chave vem do `supabase status`.
 */

/** Dominio reservado para teste (RFC 2606): nao existe e nunca vai existir. */
const DOMINIO = 'e2e.test';

export type Usuario = { id: string; nome: string; email: string; senha: string };

export type Item = {
  produto_slug: string;
  nome: string;
  tamanho: string | null;
  quantidade: number;
  preco_unitario_centavos: number;
};

type Status = 'pago' | 'em_producao' | 'enviado' | 'entregue' | 'cancelado';

function admin() {
  const local = ambienteLocal();
  return createClient(local.supabase, local.chaveSecreta, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Longa e aleatoria: passa no minimo de 8 e nao esta em vazamento nenhum. */
export function senhaNova() {
  return `e2e-${randomBytes(15).toString('base64url')}`;
}

export function emailNovo(quem: string) {
  return `${quem}-${randomBytes(5).toString('hex')}@${DOMINIO}`;
}

/** Usuario ja confirmado, sem passar pelo e-mail. */
export async function criaUsuario(nome: string): Promise<Usuario> {
  const email = emailNovo(nome.toLowerCase());
  const senha = senhaNova();

  const { data, error } = await admin().auth.admin.createUser({
    email,
    password: senha,
    email_confirm: true,
    user_metadata: { nome, termos_aceitos_em: new Date().toISOString() },
  });
  if (error || !data.user) throw new Error(`nao criei o usuario: ${error?.message}`);

  return { id: data.user.id, nome, email, senha };
}

/**
 * Pedido pronto, com itens e, se pedido, com o caminho de status percorrido.
 *
 * Cada `update` de status passa pelo gatilho do banco e escreve uma linha na
 * trilha — e a mesma trilha que a tela de detalhe mostra.
 */
export async function criaPedido(dono: Usuario, itens: Item[], caminho: Status[] = []) {
  const banco = admin();
  const total = itens.reduce((s, i) => s + i.quantidade * i.preco_unitario_centavos, 0);

  const { data: pedido, error } = await banco
    .from('orders')
    .insert({ user_id: dono.id, total_centavos: total })
    .select('id, numero')
    .single();
  if (error || !pedido) throw new Error(`nao criei o pedido: ${error?.message}`);

  const { error: erroDosItens } = await banco
    .from('order_items')
    .insert(itens.map((i) => ({ ...i, order_id: pedido.id })));
  if (erroDosItens) throw new Error(`nao criei os itens: ${erroDosItens.message}`);

  for (const status of caminho) {
    const { error: e } = await banco.from('orders').update({ status }).eq('id', pedido.id);
    if (e) throw new Error(`nao mudei o status para ${status}: ${e.message}`);
  }

  return { id: String(pedido.id), numero: Number(pedido.numero) };
}

/** O usuario com este e-mail confirmou o endereco? Lido do banco, nao da tela. */
export async function emailConfirmado(email: string) {
  const { data, error } = await admin().auth.admin.listUsers({ perPage: 200 });
  if (error) throw new Error(`nao li os usuarios: ${error.message}`);
  return Boolean(data.users.find((u) => u.email === email)?.email_confirmed_at);
}

/**
 * Apaga todo usuario da suite, e os pedidos dele.
 *
 * So quem tem e-mail no dominio de teste. O banco e local e descartavel, mas a
 * suite nao deixa lixo nem ali: rodada que herda usuario da anterior e rodada
 * que passa por acaso.
 */
export async function apagaUsuariosDaSuite() {
  const banco = admin();
  const { data, error } = await banco.auth.admin.listUsers({ perPage: 200 });
  if (error) throw new Error(`nao li os usuarios: ${error.message}`);

  let apagados = 0;
  for (const u of data.users) {
    if (!u.email?.endsWith(`@${DOMINIO}`)) continue;

    // `orders.user_id` e `on delete restrict`: pedido primeiro.
    await banco.from('orders').delete().eq('user_id', u.id);
    const { error: e } = await banco.auth.admin.deleteUser(u.id);
    if (e) throw new Error(`nao apaguei ${u.id}: ${e.message}`);
    apagados += 1;
  }
  return apagados;
}
