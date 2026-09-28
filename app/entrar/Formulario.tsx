'use client';

import { useActionState } from 'react';
import { useCaixinha, useCampos } from '@/app/_ui/campos';
import { entrar } from './acoes';
import { estadoInicial } from './estado';

export default function Formulario({ next }: { next: string }) {
  const [estado, acao, pendente] = useActionState(entrar, estadoInicial);
  // Controlados: o React 19 apagaria e-mail e caixinha quando a acao
  // respondesse com erro, e errar a senha viraria redigitar tudo (#130).
  const { campo } = useCampos({ email: '', senha: '' });
  const { caixinha } = useCaixinha();

  return (
    <form action={acao} className="auth-form" noValidate>
      <input type="hidden" name="next" value={next} />

      <label className="auth-campo">
        <span>E-mail</span>
        <input
          type="email"
          {...campo('email')}
          autoComplete="email"
          required
          // Sem autoFocus: ele rouba o scroll em telefone e joga o teclado na
          // cara de quem so abriu a pagina.
          aria-describedby={estado.erro ? 'auth-erro' : undefined}
          disabled={pendente}
        />
      </label>

      <label className="auth-campo">
        <span>Senha</span>
        <input
          type="password"
          {...campo('senha')}
          autoComplete="current-password"
          required
          aria-describedby={estado.erro ? 'auth-erro' : undefined}
          disabled={pendente}
        />
      </label>

      <div className="auth-linha">
        <label className="auth-caixinha">
          <input type="checkbox" name="lembrar" {...caixinha} disabled={pendente} />
          <span>Manter conectado</span>
        </label>

        <a href="/recuperar-senha" className="auth-link">
          Esqueci minha senha
        </a>
      </div>

      {estado.erro ? (
        // A `key` muda a cada envio: sem ela, errar a senha duas vezes seguidas
        // mostraria a mesma mensagem parada na tela, e a pessoa ficaria sem
        // saber se o segundo envio chegou a acontecer.
        <p key={estado.tentativa} id="auth-erro" className="auth-erro" role="alert">
          {estado.erro}
        </p>
      ) : null}

      {/* `.btn` e nao `.btn.cheio`: o fundo cheio esconde o ::before vermelho,
          que e justamente o que preenche o botao enquanto o envio acontece. */}
      <button
        type="submit"
        className={`btn auth-enviar${pendente ? ' carregando' : ''}`}
        disabled={pendente}
      >
        {pendente ? 'Entrando…' : 'Entrar'}
      </button>

      <p className="auth-rodape">
        Ainda não tem conta? <a href="/criar-conta">Criar conta</a>
      </p>
    </form>
  );
}
