'use client';

import { useActionState } from 'react';
import { useCampos } from '@/app/_ui/campos';
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

      {estado.recado ? (
        <p
          key={estado.tentativa}
          id="conta-recado-nome"
          className={`conta-recado ${estado.recado.tom}`}
          role="status"
        >
          {estado.recado.texto}
        </p>
      ) : null}

      <button
        type="submit"
        className={`btn auth-enviar${pendente ? ' carregando' : ''}`}
        disabled={pendente}
      >
        {pendente ? 'Salvando…' : 'Salvar'}
      </button>
    </form>
  );
}
