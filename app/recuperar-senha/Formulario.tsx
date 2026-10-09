'use client';

import { useActionState, useState } from 'react';
import ContraRobo, { SEM_AVISO } from '@/app/_ui/ContraRobo';
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
  // Protecao contra bot (#28). Quem envia antes do token chegar espera, e o
  // botao ja mostra que esta andando. So o botao: campo desabilitado nao
  // entra no envio, e o envio ainda nao saiu. O aviso dela usa o lugar do
  // erro, que ja esta reservado: nada anda quando ele aparece.
  const [robo, setRobo] = useState(SEM_AVISO);
  const andando = pendente || robo.esperando;

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

      <ContraRobo acao="recuperar-senha" tentativa={estado.tentativa} aoMudar={setRobo} />

      <Erro
        id="auth-erro"
        texto={robo.aviso ?? estado.erro}
        tentativa={robo.aviso ? `robo-${robo.vez}` : estado.tentativa}
        enviando={andando}
      />

      <button
        type="submit"
        className={`btn auth-enviar${andando ? ' carregando' : ''}`}
        disabled={andando}
      >
        <Rotulo parado="Enviar link" agindo="Enviando…" ativo={andando} />
      </button>

      <p className="auth-rodape">
        Lembrou? <a href="/entrar">Entrar</a>
      </p>
      {/* O login manda para ca quem nao lembra a senha (#260). Para quem nunca
          confirmou o e-mail, este e o melhor caminho: o link confirma a conta
          e ainda deixa uma senha que a pessoa conhece. */}
      <p className="auth-rodape">Ainda não confirmou o e-mail da conta? O link confirma também.</p>
    </form>
  );
}
