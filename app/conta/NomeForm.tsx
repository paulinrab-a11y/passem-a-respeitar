'use client';

import { useActionState } from 'react';
import { useCampos } from '@/app/_ui/campos';
import Mensagem from '@/app/_ui/Mensagem';
import Rotulo from '@/app/_ui/Rotulo';
import { salvarNome } from './acoes';
import { nomeInicial } from './estado';

export default function NomeForm({ nome }: { nome: string }) {
  const [estado, acao, pendente] = useActionState(salvarNome, nomeInicial);
  // Controlado: com `defaultValue`, o reset do React 19 devolvia o nome
  // antigo quando a acao respondia com erro, e a edicao se perdia (#130).
  const { campo } = useCampos({ nome });

  return (
    <form action={acao} className="conta-bloco">
      <label className="auth-campo">
        <span>Nome</span>
        <input
          type="text"
          {...campo('nome')}
          maxLength={80}
          required
          disabled={pendente}
          aria-describedby={estado.recado ? 'conta-recado-nome' : undefined}
        />
      </label>

      <Mensagem
        id="conta-recado-nome"
        texto={estado.recado?.texto}
        chave={estado.tentativa}
        classe={`conta-recado ${estado.recado?.tom ?? 'ok'}`}
        papel="status"
      />

      <button
        type="submit"
        className={`btn auth-enviar${pendente ? ' carregando' : ''}`}
        disabled={pendente}
      >
        <Rotulo parado="Salvar" agindo="Salvando…" ativo={pendente} />
      </button>
    </form>
  );
}
