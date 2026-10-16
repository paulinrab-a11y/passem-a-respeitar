'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import ContraRobo, { SEM_AVISO } from '@/app/_ui/ContraRobo';
import { comErro, useCaixinha } from '@/app/_ui/campos';
import Erro from '@/app/_ui/Erro';
import Rotulo from '@/app/_ui/Rotulo';
import { pedirCodigo } from './acoes-codigo';
import CodigoDeEntrada from './CodigoDeEntrada';
import { pedirCodigoInicial } from './estado';

/**
 * Entrar com um codigo no e-mail, sem senha (#387).
 *
 * O aceite da politica aparece sempre: a conta pode nascer deste pedido, e
 * mostrar a caixa so para quem nao tem conta seria contar quem tem. O texto
 * e o do cadastro. Desmarcada por padrao, e o servidor recusa sem ela.
 *
 * Campos controlados pelo mesmo motivo do login (#130): o React 19 apagaria
 * o e-mail e as caixas quando a acao respondesse com erro.
 */
export default function FormularioCodigo({
  next,
  classe = 'auth-form',
  aoUsarSenha,
}: {
  next: string;
  classe?: string;
  aoUsarSenha: () => void;
}) {
  const [estado, acao, pendente] = useActionState(pedirCodigo, pedirCodigoInicial);
  const [email, setEmail] = useState('');
  const lembrar = useCaixinha();
  const aceite = useCaixinha();
  const [robo, setRobo] = useState(SEM_AVISO);
  const andando = pendente || robo.esperando;
  const form = useRef<HTMLFormElement>(null);
  // "Trocar e-mail" na tela do codigo volta para ca com o que estava
  // digitado. Guarda EM QUAL envio a pessoa voltou, como no cadastro.
  const [voltouEm, setVoltouEm] = useState(-1);

  // Foco no campo que errou. `tentativa` reanima quando o mesmo campo erra
  // duas vezes seguidas.
  // biome-ignore lint/correctness/useExhaustiveDependencies: tentativa reanima o foco quando o mesmo campo erra de novo
  useEffect(() => {
    if (!estado.campo) return;
    const alvo = form.current?.elements.namedItem(estado.campo);
    if (alvo instanceof HTMLInputElement) alvo.focus();
  }, [estado.campo, estado.tentativa]);

  if (estado.enviado && voltouEm !== estado.tentativa) {
    return (
      <CodigoDeEntrada
        email={estado.enviado.email}
        next={next}
        lembrar={estado.enviado.lembrar}
        aoTrocarEmail={() => setVoltouEm(estado.tentativa)}
      />
    );
  }

  const erroEm = (campo: 'email' | 'aceite') => comErro(estado.campo === campo, 'auth-erro');

  return (
    <form action={acao} ref={form} className={classe} noValidate>
      <input type="hidden" name="next" value={next} />

      <label className="auth-campo">
        <span>E-mail</span>
        <input
          type="email"
          name="email"
          autoComplete="email"
          required
          disabled={pendente}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          {...erroEm('email')}
        />
      </label>

      <label className="auth-caixinha">
        <input type="checkbox" name="lembrar" {...lembrar.caixinha} disabled={pendente} />
        <span>Manter conectado</span>
      </label>

      {/* O link abre em outra aba para nao perder o que ja foi digitado. */}
      <label className="auth-caixinha">
        <input
          type="checkbox"
          name="aceite"
          {...aceite.caixinha}
          disabled={pendente}
          {...erroEm('aceite')}
        />
        <span>
          Li e aceito a{' '}
          <a href="/privacidade" target="_blank" rel="noopener">
            política de privacidade
          </a>
        </span>
      </label>

      <ContraRobo acao="entrar-codigo" tentativa={estado.tentativa} aoMudar={setRobo} />

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
        <Rotulo parado="Receber código" agindo="Enviando…" ativo={andando} />
      </button>

      {/* Vale para todo mundo, entao nao conta quem tem conta. */}
      <p className="auth-rodape">
        Sem conta com esse e-mail? Ela é criada quando você confirmar o código.
      </p>
      <p className="auth-rodape">
        Tem senha?{' '}
        <button type="button" className="auth-alterna" onClick={aoUsarSenha}>
          Usar senha
        </button>
      </p>
    </form>
  );
}
