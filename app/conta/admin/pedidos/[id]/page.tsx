import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { ehAdmin } from '@/lib/admin';
import { linhasDaEntrega, PAINEL } from '@/lib/conta/painel';
import {
  type LinhaDoPainel,
  mapeiaPedidoDoPainel,
  nomeDoAutor,
  quemLer,
} from '@/lib/conta/pedido-admin';
import { pareceUuid } from '@/lib/conta/pedidos';
import { formataDataHora } from '@/lib/datas';
import { ehStatusPedido } from '@/lib/loja/status-do-pedido';
import { ENTRAR } from '@/lib/rotas';
import { clienteAdmin } from '@/lib/supabase/admin';
import { usuarioDaSessao } from '@/lib/supabase/servidor';
import Rastreio from '../../../Rastreio';
import CopiarEndereco from '../CopiarEndereco';
import MudarStatus from '../MudarStatus';
import Selo from '../Selo';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Pedido — administração — Passem a Respeitar',
  robots: { index: false, follow: false },
};

/**
 * Colunas nomeadas (#20), com os filhos na mesma ida. De `pagamentos`, o que
 * explica uma recusa — estado e `provedor_status_detail` —, e nada que sirva
 * para mexer numa cobranca: `idempotency_key` e `provedor_pagamento_id`
 * ficam no banco.
 */
const COLUNAS =
  'numero, status, criado_em, total_centavos, frete_centavos, frete_servico, frete_prazo_dias, user_id, termos_aceitos_em, rastreio_codigo, rastreio_url, entrega_nome, entrega_cep, entrega_logradouro, entrega_numero, entrega_complemento, entrega_bairro, entrega_cidade, entrega_uf, order_items(id, nome, tamanho, quantidade, preco_unitario_centavos), order_status_history(id, para, autor, motivo, criado_em), pagamentos(tentativa, metodo, estado, provedor_status_detail, valor_centavos, criado_em)';

/**
 * O pedido visto pelo dono (Issue #345).
 *
 * O card do painel levava a /conta/pedidos/{id}, que e a tela do CLIENTE:
 * filtra por `user_id`, e por isso dava 404 para o dono em todo pedido que
 * nao era dele. Esta e a tela dele.
 *
 * Mesma ordem do painel e do detalhe do cliente (#160): sessao, papel, id e
 * pedido sao conferidos ANTES do primeiro byte. Quem nao administra recebe
 * 404 — a tela nao existe para essa pessoa —, e pedido que nao existe tambem.
 * Nao ha `<Suspense>`: o que demora aqui e o banco, e e o banco que decide o
 * 404; status HTTP so existe ate a resposta comecar.
 */
export default async function PedidoAdmin({ params }: { params: Promise<{ id: string }> }) {
  const usuario = await usuarioDaSessao();
  if (!usuario) redirect(ENTRAR);

  if (!ehAdmin({ email: usuario.email, emailVerificado: Boolean(usuario.email_confirmed_at) })) {
    notFound();
  }

  const { id } = await params;
  // Id torto viraria erro do PostgREST; erro na tela e diferente de 404.
  if (!pareceUuid(id)) notFound();

  // So depois da conferencia de papel: e o client que ve o banco inteiro.
  const admin = clienteAdmin();

  const { data, error } = await admin
    .from('orders')
    .select(COLUNAS)
    .eq('id', id)
    .order('criado_em', { referencedTable: 'order_status_history', ascending: true })
    .order('tentativa', { referencedTable: 'pagamentos', ascending: false })
    .maybeSingle();

  if (error) console.warn('[admin] pedido indisponivel:', error.code);
  if (!data) notFound();

  const linha = data as LinhaDoPainel;

  // O e-mail do comprador e de quem aparece na trilha. Um uuid por chamada,
  // em paralelo; sao dois ou tres. Falha de leitura vira "sem e-mail", nunca
  // tela quebrada: o resto do pedido continua valendo.
  const lidos = await Promise.all(
    quemLer(linha).map(async (uid) => {
      const { data: conta } = await admin.auth.admin.getUserById(uid).catch(() => ({
        data: null,
      }));
      const email = conta?.user?.email;
      return email ? ([uid, email] as const) : null;
    })
  );
  const emails = new Map(lidos.filter((l) => l !== null));

  const pedido = mapeiaPedidoDoPainel(linha, emails);
  const linhas = pedido.entrega ? linhasDaEntrega(pedido.entrega) : [];

  return (
    <main className="auth conta">
      <div className="auth-scan" aria-hidden="true" />
      <div className="auth-vinheta" aria-hidden="true" />

      <section className="auth-caixa conta-caixa">
        <a href={PAINEL} className="auth-voltar">
          ← Pedidos
        </a>

        <h1>Pedido #{pedido.numero}</h1>

        <p className="detalhe-topo">
          <Selo rotulo={pedido.rotulo} tom={pedido.tom} />
          <time dateTime={pedido.criadoEm}>{formataDataHora(pedido.criadoEm)}</time>
        </p>

        <section className="detalhe-bloco">
          <h2>Comprador</h2>
          {pedido.email ? (
            <p className="entrega-nome">
              <a href={`mailto:${pedido.email}`}>{pedido.email}</a>
            </p>
          ) : (
            <p className="detalhe-nota">
              Sem e-mail: a conta foi excluída ou não consegui ler agora.
            </p>
          )}
          {pedido.termosAceitosEm ? (
            <p className="detalhe-nota">
              Aceitou os termos em{' '}
              <time dateTime={pedido.termosAceitosEm}>
                {formataDataHora(pedido.termosAceitosEm)}
              </time>
              .
            </p>
          ) : null}
        </section>

        <section className="detalhe-bloco">
          <h2>Itens</h2>
          {pedido.itens.length === 0 ? (
            <p className="detalhe-nota">Este pedido não tem itens registrados.</p>
          ) : (
            <ul className="pedido-itens">
              {pedido.itens.map((item) => (
                <li key={item.id}>
                  <span className="pedido-item-nome">{item.nome}</span>
                  <span className="pedido-item-detalhe">
                    {item.tamanho ? `tam. ${item.tamanho} · ` : ''}
                    {item.quantidade} × {item.precoUnitario}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {pedido.frete ? (
            <p className="pedido-frete">
              <span>
                Enviar por {pedido.frete.servico}, {pedido.frete.prazo}
              </span>
              <span>{pedido.frete.valor}</span>
            </p>
          ) : null}

          <p className="pedido-total">
            <span>Total</span>
            <strong>{pedido.total}</strong>
          </p>
        </section>

        <section className="detalhe-bloco">
          <h2>Entrega</h2>
          {pedido.entrega ? (
            <div className="admin-entrega-corpo">
              <p>
                {linhas.map((l, i) => (
                  <span key={l}>
                    {i > 0 ? <br /> : null}
                    {i === 0 ? <strong>{l}</strong> : l}
                  </span>
                ))}
              </p>
              <CopiarEndereco texto={linhas.join('\n')} pedido={pedido.numero} />
            </div>
          ) : (
            <p className="detalhe-nota">Sem endereço: pedido antigo ou de conta excluída.</p>
          )}
        </section>

        {/* O codigo que o cliente esta vendo (#378): e o que o dono confere
            quando a pessoa pergunta onde esta o pacote. */}
        {pedido.rastreio ? <Rastreio rastreio={pedido.rastreio} /> : null}

        <section className="detalhe-bloco">
          <h2>Status</h2>
          {pedido.trilha.length === 0 ? (
            <p className="detalhe-nota">Nenhuma mudança registrada.</p>
          ) : (
            <ol className="pedido-itens">
              {pedido.trilha.map((e) => (
                <li key={e.id}>
                  <span className="pedido-item-nome">
                    {e.rotulo}
                    <span className="admin-trilha-quem">
                      por {nomeDoAutor(e.autor)}
                      {e.motivo ? ` · ${e.motivo}` : ''}
                    </span>
                  </span>
                  <span className="pedido-item-detalhe">
                    <time dateTime={e.em}>{formataDataHora(e.em)}</time>
                  </span>
                </li>
              ))}
            </ol>
          )}

          {ehStatusPedido(pedido.status) ? (
            <MudarStatus pedido={id} status={pedido.status} />
          ) : null}
        </section>

        <section className="detalhe-bloco">
          <h2>Tentativas de pagamento</h2>
          {pedido.tentativas.length === 0 ? (
            <p className="detalhe-nota">Nenhuma tentativa ainda.</p>
          ) : (
            <ul className="pedido-itens">
              {pedido.tentativas.map((t) => (
                <li key={t.tentativa}>
                  <span className="pedido-item-nome">
                    {t.tentativa}ª · {t.metodo} · {t.estado}
                    {t.detalhe ? <span className="admin-trilha-quem">{t.detalhe}</span> : null}
                  </span>
                  <span className="pedido-item-detalhe">
                    {t.valor} · <time dateTime={t.em}>{formataDataHora(t.em)}</time>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </section>
    </main>
  );
}
