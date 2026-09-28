'use client';

import { useActionState } from 'react';
import Mensagem from '@/app/_ui/Mensagem';
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

      <Mensagem
        texto={estado.recado?.texto}
        chave={estado.tentativa}
        classe={`conta-recado ${estado.recado?.tom ?? 'ok'}`}
        papel="status"
      />

      <button type="submit" className={`btn${pendente ? ' carregando' : ''}`} disabled={pendente}>
        <Rotulo parado="Reenviar verificação" agindo="Enviando…" ativo={pendente} />
      </button>
    </form>
  );
}
