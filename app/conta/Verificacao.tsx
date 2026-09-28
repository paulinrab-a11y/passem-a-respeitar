'use client';

import { useActionState } from 'react';
import Rotulo from '@/app/_ui/Rotulo';
import { reenviarVerificacao } from './acoes';
import { verificacaoInicial } from './estado';

export default function Verificacao() {
  const [estado, acao, pendente] = useActionState(reenviarVerificacao, verificacaoInicial);

  return (
    <form action={acao} className="conta-aviso">
      <p>
        Seu e-mail ainda não foi verificado. Sem isso, não dá para recuperar a senha nem receber
        aviso de pedido.
      </p>

      {estado.recado ? (
        <p key={estado.tentativa} className={`conta-recado ${estado.recado.tom}`} role="status">
          {estado.recado.texto}
        </p>
      ) : null}

      <button type="submit" className={`btn${pendente ? ' carregando' : ''}`} disabled={pendente}>
        <Rotulo parado="Reenviar verificação" agindo="Enviando…" ativo={pendente} />
      </button>
    </form>
  );
}
