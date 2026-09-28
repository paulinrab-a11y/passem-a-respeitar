'use client';

import { useActionState, useEffect } from 'react';
import { useCaixinha, useCampos } from '@/app/_ui/campos';
import { useDesmonteAnimado } from '@/app/_ui/desmonte-animado';
import Rotulo from '@/app/_ui/Rotulo';
import { exclusaoInicial } from './estado-exclusao';
import { excluirConta } from './excluir';

/**
 * Exclusao de conta em duas etapas.
 *
 * A primeira etapa e so o aviso: ela existe para a pessoa ler o que vai
 * acontecer antes de ver qualquer campo. So depois aparecem o e-mail e a
 * senha — digitar o proprio endereco e o atrito que separa "quero fechar
 * isso" de um clique errado.
 */
export default function ExcluirConta({ email }: { email: string }) {
  const [estado, acao, pendente] = useActionState(excluirConta, exclusaoInicial);
  // A caixinha nao e `checked` controlado: o reset do formulario a desmarcaria
  // na tela com o estado ainda marcado, e o botao ficaria liberado sem o
  // aceite visivel (#130).
  const { marcada: confirmo, caixinha } = useCaixinha();
  const { montado, saindo, abrir, fechar, aoFimDaAnimacao } = useDesmonteAnimado(400);
  // Controlados: o React 19 apagaria e-mail e senha quando a acao respondesse
  // com erro (#130).
  const { campo, limpar } = useCampos({ email: '', senha: '' });

  // Cancelou: o que foi digitado morre com a caixa, como morria quando os
  // campos eram do DOM. So depois da saida animada, para nada piscar.
  useEffect(() => {
    if (!montado) limpar();
  }, [montado, limpar]);

  return (
    <section className="excluir">
      <h2>Excluir minha conta</h2>

      {montado ? (
        <div className={`excluir-caixa${saindo ? ' saindo' : ''}`} onAnimationEnd={aoFimDaAnimacao}>
          <p className="excluir-aviso">
            Isso apaga o seu perfil, a sua foto e todas as sessões abertas. Não dá para desfazer, e
            o e-mail fica livre para um cadastro novo.
          </p>
          <p className="excluir-aviso">
            Seus pedidos continuam existindo por obrigação fiscal, mas deixam de apontar para você:
            ninguém consegue ligar aquela compra ao seu nome depois disso.
          </p>

          <form action={acao} className="excluir-form">
            <label className="auth-campo">
              <span>Digite {email} para confirmar</span>
              <input
                type="email"
                {...campo('email')}
                autoComplete="off"
                required
                disabled={pendente}
              />
            </label>

            <label className="auth-campo">
              <span>Sua senha</span>
              <input
                type="password"
                {...campo('senha')}
                autoComplete="current-password"
                required
                disabled={pendente}
              />
            </label>

            <label className="auth-caixinha">
              <input type="checkbox" {...caixinha} disabled={pendente} />
              <span>Entendi que não dá para desfazer</span>
            </label>

            {estado.recado ? (
              <p className={`conta-recado ${estado.recado.tom}`} role="alert">
                {estado.recado.texto}
              </p>
            ) : null}

            <div className="excluir-acoes">
              <button
                type="submit"
                className={`btn perigo${pendente ? ' carregando' : ''}`}
                disabled={pendente || !confirmo}
              >
                <Rotulo parado="Excluir minha conta" agindo="Excluindo…" ativo={pendente} />
              </button>

              <button type="button" className="auth-link" onClick={fechar} disabled={pendente}>
                Cancelar
              </button>
            </div>
          </form>
        </div>
      ) : (
        <button type="button" className="auth-link" onClick={abrir}>
          Quero excluir minha conta
        </button>
      )}
    </section>
  );
}
