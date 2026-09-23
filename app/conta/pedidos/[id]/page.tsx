import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { pareceUuid } from '@/lib/conta/pedidos';
import { ENTRAR } from '@/lib/rotas';
import { meuPedido } from './busca-pedido';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Pedido — Passem a Respeitar',
  robots: { index: false, follow: false },
};

const dia = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

/** A trilha ganha hora: numa linha do tempo, "quando" inclui a que horas. */
const diaEHora = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

/** Texto do estado da etapa para quem ouve a pagina em vez de olhar. */
const EM_PALAVRAS = {
  feita: 'concluída',
  atual: 'etapa atual',
  futura: 'ainda não aconteceu',
  'nao-aconteceu': 'não vai acontecer',
} as const;

export default async function DetalheDoPedido({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // Conferido antes de falar com o banco: id torto viraria erro do PostgREST, e
  // erro na tela e diferente de 404 — e a diferenca por si ja conta algo a quem
  // esta chutando endereco.
  if (!pareceUuid(id)) notFound();

  const resultado = await meuPedido(id);

  // Segunda verificacao de sessao, depois do middleware (#29).
  if (resultado.tipo === 'sem-sessao') redirect(ENTRAR);

  // Nao existe, ou e de outra pessoa. A mesma resposta para os dois, porque a
  // consulta tambem nao sabe qual dos dois e. (Criterio da #42: 404, nao 403.)
  if (resultado.tipo === 'nao-achei') notFound();

  const { pedido } = resultado;
  const linha = pedido.linhaDoTempo;

  return (
    <main className="auth conta">
      <div className="auth-scan" aria-hidden="true" />
      <div className="auth-vinheta" aria-hidden="true" />

      <section className="auth-caixa conta-caixa">
        <a href="/conta/pedidos" className="auth-voltar">
          ← Pedidos
        </a>

        <h1>Pedido #{pedido.numero}</h1>

        <p className="detalhe-topo">
          <span className={`pedido-status ${pedido.tom}`}>{pedido.rotulo}</span>
          <time dateTime={pedido.criadoEm}>{dia.format(new Date(pedido.criadoEm))}</time>
        </p>

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

          <p className="pedido-total">
            <span>Total</span>
            <strong>{pedido.total}</strong>
          </p>
        </section>

        <section className="detalhe-bloco">
          <h2>Andamento</h2>

          {linha.semRegistro ? (
            <p className="detalhe-nota">
              Este pedido não tem registro de etapas. O andamento abaixo aparece vazio porque nada
              foi registrado — não porque nada aconteceu.
            </p>
          ) : null}

          <ol className="etapas">
            {linha.etapas.map((etapa) => (
              <li
                key={etapa.rotulo}
                className={etapa.estado}
                aria-current={etapa.estado === 'atual' ? 'step' : undefined}
              >
                <span className="etapa-marca" aria-hidden="true" />
                <span className="etapa-nome">{etapa.rotulo}</span>
                <span className="etapa-quando">
                  {etapa.em ? (
                    <time dateTime={etapa.em}>{diaEHora.format(new Date(etapa.em))}</time>
                  ) : (
                    <span aria-hidden="true">—</span>
                  )}
                </span>
                {/* O estado nao pode depender so da cor e da posicao. */}
                <span className="sr">{EM_PALAVRAS[etapa.estado]}</span>
              </li>
            ))}

            {linha.ramo ? (
              <li className="ramo" aria-current="step">
                <span className="etapa-marca" aria-hidden="true" />
                <span className="etapa-nome">{linha.ramo.rotulo}</span>
                <span className="etapa-quando">
                  {linha.ramo.em ? (
                    <time dateTime={linha.ramo.em}>{diaEHora.format(new Date(linha.ramo.em))}</time>
                  ) : (
                    <span aria-hidden="true">—</span>
                  )}
                </span>
                <span className="sr">etapa atual</span>
              </li>
            ) : null}
          </ol>
        </section>
      </section>
    </main>
  );
}
