'use client';

import { useActionState, useState } from 'react';
import ContraRobo, { SEM_AVISO } from '@/app/_ui/ContraRobo';
import { comErro, useCaixinha, useCampos } from '@/app/_ui/campos';
import Erro from '@/app/_ui/Erro';
import Rotulo from '@/app/_ui/Rotulo';
import { entrar } from './acoes';
import Codigo from './Codigo';
import { estadoInicial } from './estado';

export default function Formulario({ next }: { next: string }) {
  const [estado, acao, pendente] = useActionState(entrar, estadoInicial);
  // Controlados: o React 19 apagaria e-mail e caixinha quando a acao
  // respondesse com erro, e errar a senha viraria redigitar tudo (#130).
  const { campo } = useCampos({ email: '', senha: '' });
  const { caixinha } = useCaixinha();
  // Protecao contra bot (#28). Quem envia antes do token chegar espera, e o
  // botao ja mostra que esta andando. So o botao: campo desabilitado nao
  // entra no envio, e o envio ainda nao saiu. O aviso dela usa o lugar do
  // erro, que ja esta reservado: nada anda quando ele aparece.
  const [robo, setRobo] = useState(SEM_AVISO);
  const andando = pendente || robo.esperando;
  // "Voltar" na tela do codigo (#260) devolve o formulario com o que ja
  // estava digitado. Guarda EM QUAL envio a pessoa voltou: entrar de novo e
  // outro envio, e a tela do codigo aparece outra vez.
  const [voltouEm, setVoltouEm] = useState(-1);

  if (estado.confirmar && voltouEm !== estado.tentativa) {
    return (
      <Codigo
        email={estado.confirmar.email}
        next={next}
        lembrar={estado.confirmar.lembrar}
        enviado={estado.confirmar.enviado}
        aoVoltar={() => setVoltouEm(estado.tentativa)}
      />
    );
  }

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

      <ContraRobo acao="entrar" tentativa={estado.tentativa} aoMudar={setRobo} />

      <Erro
        id="auth-erro"
        texto={robo.aviso ?? estado.erro}
        tentativa={robo.aviso ? `robo-${robo.vez}` : estado.tentativa}
        enviando={andando}
      />

      {/* `.btn` e nao `.btn.cheio`: o fundo cheio esconde o ::before vermelho,
          que e justamente o que preenche o botao enquanto o envio acontece. */}
      <button
        type="submit"
        className={`btn auth-enviar${andando ? ' carregando' : ''}`}
        disabled={andando}
      >
        <Rotulo parado="Entrar" agindo="Entrando…" ativo={andando} />
      </button>

      <p className="auth-rodape">
        Ainda não tem conta? <a href="/criar-conta">Criar conta</a>
      </p>
    </form>
  );
}
