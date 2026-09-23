'use client';

import { useActionState } from 'react';
import type { Sessao } from '@/lib/conta/sessoes';
import { encerrarSessao } from './acoes';
import { sessaoInicial } from './estado-sessoes';

const quando = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

export default function Sessoes({ sessoes }: { sessoes: Sessao[] }) {
  const [estado, acao, pendente] = useActionState(encerrarSessao, sessaoInicial);

  if (sessoes.length === 0) return null;

  return (
    <section className="sessoes">
      <h2>Aparelhos conectados</h2>
      <p className="sessoes-nota">Se você não reconhece algum, encerre e troque a senha.</p>

      <ul>
        {sessoes.map((s, i) => (
          <li
            key={s.identificador}
            // A linha que acabou de ser encerrada ainda chega do servidor uma
            // vez; a classe deixa ela sair animada em vez de sumir de um
            // quadro para o outro.
            className={estado.encerrado === s.identificador ? 'saindo' : undefined}
            // Stagger de 40ms limitado aos quatro primeiros: numa lista longa,
            // esperar o decimo item aparecer vira lentidao, nao elegancia.
            style={i < 4 ? { animationDelay: `${i * 40}ms` } : undefined}
          >
            <div className="sessoes-quem">
              <p className="sessoes-aparelho">
                {s.navegador}
                {s.sistema ? ` · ${s.sistema}` : ''}
                {s.atual ? <span className="sessoes-selo">este aparelho</span> : null}
              </p>
              <p className="sessoes-detalhe">
                {quando.format(new Date(s.ultimoAcesso))}
                {s.rede ? ` · rede ${s.rede}` : ''}
              </p>
            </div>

            {s.atual ? (
              // Sem botao na atual, de proposito: encerrar a si mesmo por um
              // botao de lista e "sair" disfarcado, e sair tem o proprio
              // botao, na tela de conta.
              <span className="sessoes-agora">em uso</span>
            ) : (
              <form action={acao}>
                <input type="hidden" name="identificador" value={s.identificador} />
                <button type="submit" className="auth-link" disabled={pendente}>
                  Encerrar
                </button>
              </form>
            )}
          </li>
        ))}
      </ul>

      {estado.recado ? (
        <p className={`conta-recado ${estado.recado.tom}`} role="status">
          {estado.recado.texto}
        </p>
      ) : null}
    </section>
  );
}
