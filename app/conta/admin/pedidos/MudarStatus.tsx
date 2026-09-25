'use client';

import { useActionState } from 'react';
import { proximosDe, type StatusPedido, VERBO } from '@/lib/loja/status-do-pedido';
import { mudarStatus } from './acoes';
import { adminInicial } from './estado';

/**
 * Os botoes de um pedido (Issue #43).
 *
 * Um formulario por pedido, um botao por transicao permitida. Nao ha
 * <select> com todos os status: o que nao pode ser feito nao aparece, e
 * isso e o que impede o erro antes de ele existir. O `motivo` e um campo
 * so, opcional, que vale para o botao clicado.
 */
export default function MudarStatus({ pedido, status }: { pedido: string; status: StatusPedido }) {
  const [estado, acao, pendente] = useActionState(mudarStatus, adminInicial);
  const destinos = proximosDe(status);

  if (destinos.length === 0) {
    return <p className="detalhe-nota admin-final">Sem próxima etapa.</p>;
  }

  return (
    <form action={acao} className="admin-acoes">
      <input type="hidden" name="pedido" value={pedido} />

      <label className="auth-campo">
        <span>Motivo (opcional)</span>
        <input name="motivo" type="text" maxLength={300} disabled={pendente} />
      </label>

      <div className="admin-botoes">
        {destinos.map((para) => (
          <button
            key={para}
            type="submit"
            name="para"
            value={para}
            disabled={pendente}
            className={`btn${para === 'cancelado' || para === 'reembolsado' ? '' : ' cheio'}${pendente ? ' carregando' : ''}`}
          >
            {VERBO[para]}
          </button>
        ))}
      </div>

      {estado.recado && estado.pedido === pedido ? (
        <p className={`conta-recado ${estado.recado.tom}`} role="alert">
          {estado.recado.texto}
        </p>
      ) : null}
    </form>
  );
}
