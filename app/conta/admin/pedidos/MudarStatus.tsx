'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
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
 *
 * Quando o status muda, os botoes da etapa seguinte entram com fade (#157).
 * So opacidade e um deslocamento por `transform`: nada que ocupe espaco, e o
 * card nao e empurrado. Na carga da pagina nao ha entrada — sao cinquenta
 * cards, e todos animando juntos nao dizem qual mudou.
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

  // O status com que o card chegou. Diferente dele, houve mudanca nesta
  // visita, e o que entra agora entra animado.
  const deChegada = useRef(status);
  const mudou = status !== deChegada.current;

  const recado = (
    <Mensagem
      texto={estado.pedido === pedido ? estado.recado?.texto : null}
      chave={estado.recado?.texto ?? ''}
      classe={`conta-recado ${estado.recado?.tom ?? 'erro'}`}
      papel="alert"
    />
  );

  if (destinos.length === 0) {
    return (
      <div className="admin-acoes">
        <p className={`detalhe-nota admin-final${mudou ? ' entrou' : ''}`}>Sem próxima etapa.</p>
        {/* A ultima mudanca tambem merece o "status atualizado": antes o
            recado morava dentro do formulario e sumia junto com ele. */}
        {recado}
      </div>
    );
  }

  return (
    <form action={acao} className="admin-acoes">
      <input type="hidden" name="pedido" value={pedido} />

      <label className="auth-campo">
        <span>Motivo (opcional)</span>
        <input {...campo('motivo')} type="text" maxLength={300} disabled={pendente} />
      </label>

      {/* A `key` troca o bloco inteiro quando o status muda: os botoes da
          etapa nova sao elementos novos, e a entrada roda de novo. */}
      <div key={status} className={`admin-botoes${mudou ? ' entrou' : ''}`}>
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

      {recado}
    </form>
  );
}
