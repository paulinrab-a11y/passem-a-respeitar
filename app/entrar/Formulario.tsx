'use client';

import { useActionState } from 'react';
import { comErro, useCaixinha, useCampos } from '@/app/_ui/campos';
import Erro from '@/app/_ui/Erro';
import Rotulo from '@/app/_ui/Rotulo';
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
          {...comErro(estado.campo === 'credenciais', 'auth-erro')}
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
          {...comErro(estado.campo === 'credenciais', 'auth-erro')}
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

      <Erro id="auth-erro" texto={estado.erro} tentativa={estado.tentativa} enviando={pendente} />

      {/* `.btn` e nao `.btn.cheio`: o fundo cheio esconde o ::before vermelho,
          que e justamente o que preenche o botao enquanto o envio acontece. */}
      <button
        type="submit"
        className={`btn auth-enviar${pendente ? ' carregando' : ''}`}
        disabled={pendente}
      >
        <Rotulo parado="Entrar" agindo="Entrando…" ativo={pendente} />
      </button>

      <p className="auth-rodape">
        Ainda não tem conta? <a href="/criar-conta">Criar conta</a>
      </p>
    </form>
  );
}
