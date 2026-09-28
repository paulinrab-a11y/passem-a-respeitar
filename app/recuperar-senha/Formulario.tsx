'use client';

import { useActionState, useState } from 'react';
import { comErro } from '@/app/_ui/campos';
import Erro from '@/app/_ui/Erro';
import Rotulo from '@/app/_ui/Rotulo';
import { recuperarSenha } from './acoes';
import { recuperarInicial } from './estado';

export default function Formulario() {
  const [estado, acao, pendente] = useActionState(recuperarSenha, recuperarInicial);
  // Controlado: o React 19 apagaria o campo quando a acao respondesse com
  // erro (#130).
  const [email, setEmail] = useState('');

  if (estado.enviado) {
    return (
      <div className="auth-form" role="status">
        <p className="auth-sub">Confira seu e-mail</p>
        <p className="detalhe-nota">
          Se <strong>{email}</strong> tiver conta, enviamos um link para criar uma senha nova. Ele
          vence em uma hora e só vale uma vez. Não chegou? Olhe o spam.
        </p>
        <a className="btn" href="/entrar">
          Voltar ao login
        </a>
      </div>
    );
  }

  return (
    <form action={acao} className="auth-form" noValidate>
      <label className="auth-campo">
        <span>E-mail da conta</span>
        <input
          type="email"
          name="email"
          autoComplete="email"
          required
          disabled={pendente}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          {...comErro(estado.campo === 'email', 'auth-erro')}
        />
      </label>

      <Erro id="auth-erro" texto={estado.erro} tentativa={estado.tentativa} />

      <button
        type="submit"
        className={`btn auth-enviar${pendente ? ' carregando' : ''}`}
        disabled={pendente}
      >
        <Rotulo parado="Enviar link" agindo="Enviando…" ativo={pendente} />
      </button>

      <p className="auth-rodape">
        Lembrou? <a href="/entrar">Entrar</a>
      </p>
    </form>
  );
}
