'use client';

import { useActionState, useEffect, useState } from 'react';
import { useCampos } from '@/app/_ui/campos';
import Mensagem from '@/app/_ui/Mensagem';
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
  // Qual botao foi clicado. `pendente` e do formulario inteiro; sem isto as
  // tres transicoes carregariam juntas e nao daria para saber qual saiu (#50).
  const [clicado, setClicado] = useState<string | null>(null);
  // Controlado: o React 19 apagaria o motivo quando a acao respondesse com
  // erro (#130). No sucesso ele sai, para nao valer para a proxima etapa.
  const { campo, limpar } = useCampos({ motivo: '' });

  useEffect(() => {
    if (estado.recado?.tom === 'ok' && estado.pedido === pedido) limpar();
  }, [estado.recado, estado.pedido, pedido, limpar]);

  if (destinos.length === 0) {
    return <p className="detalhe-nota admin-final">Sem próxima etapa.</p>;
  }

  return (
    <form action={acao} className="admin-acoes">
      <input type="hidden" name="pedido" value={pedido} />

      <label className="auth-campo">
        <span>Motivo (opcional)</span>
        <input {...campo('motivo')} type="text" maxLength={300} disabled={pendente} />
      </label>

      <div className="admin-botoes">
        {destinos.map((para) => (
          <button
            key={para}
            type="submit"
            name="para"
            value={para}
            disabled={pendente}
            onClick={() => setClicado(para)}
            className={`btn${para === 'cancelado' || para === 'reembolsado' ? '' : ' cheio'}${pendente && clicado === para ? ' carregando' : ''}`}
          >
            {VERBO[para]}
          </button>
        ))}
      </div>

      <Mensagem
        texto={estado.pedido === pedido ? estado.recado?.texto : null}
        chave={estado.recado?.texto ?? ''}
        classe={`conta-recado ${estado.recado?.tom ?? 'erro'}`}
        papel="alert"
      />
    </form>
  );
}
