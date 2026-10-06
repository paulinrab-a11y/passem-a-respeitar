'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import ContraRobo, { SEM_AVISO } from '@/app/_ui/ContraRobo';
import { comErro, useCaixinha } from '@/app/_ui/campos';
import Erro from '@/app/_ui/Erro';
import Rotulo from '@/app/_ui/Rotulo';
import { forcaDaSenha, SENHA_MIN } from '@/lib/conta/senha';
import { criarConta } from './acoes';
import { criarContaInicial } from './estado';

/**
 * Formulario de cadastro (Issue #30).
 *
 * Mesmo vocabulario do login: campos com label que nao some, erro inline
 * animado sem tremer a tela, botao que vira barra de progresso no envio.
 * O medidor de senha e o mesmo da troca de senha — orientacao, nao veredito.
 */
export default function Formulario() {
  const [estado, acao, pendente] = useActionState(criarConta, criarContaInicial);
  // Todos os campos sao controlados, e nao so a senha: o React 19 reseta os
  // campos nao-controlados de um <form action> assim que a acao responde —
  // inclusive quando ela responde com ERRO. Sem isto, errar o aceite apagava
  // nome, e-mail e confirmacao, e a pessoa recomecava do zero. Medido no
  // preview da #30.
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [confirmacao, setConfirmacao] = useState('');
  // A caixinha tambem: errar a senha nao pode desmarcar o aceite (#130).
  const { caixinha } = useCaixinha();
  const forca = forcaDaSenha(senha);
  const form = useRef<HTMLFormElement>(null);
  // Protecao contra bot (#28). Quem envia antes do token chegar espera, e o
  // botao ja mostra que esta andando. So o botao: campo desabilitado nao
  // entra no envio, e o envio ainda nao saiu. O aviso dela usa o lugar do
  // erro, que ja esta reservado: nada anda quando ele aparece.
  const [robo, setRobo] = useState(SEM_AVISO);
  const andando = pendente || robo.esperando;

  // Foco no campo que errou, para a pessoa nao cacar qual dos cinco foi.
  //
  // `tentativa` entra nas dependencias de proposito: errar o MESMO campo duas
  // vezes seguidas nao muda `campo`, e sem o contador o foco nao voltaria na
  // segunda. O Biome le isso como dependencia a mais; e a menos.
  // biome-ignore lint/correctness/useExhaustiveDependencies: tentativa reanima o foco quando o mesmo campo erra de novo
  useEffect(() => {
    if (!estado.campo) return;
    const alvo = form.current?.elements.namedItem(estado.campo);
    if (alvo instanceof HTMLInputElement) alvo.focus();
  }, [estado.campo, estado.tentativa]);

  if (estado.enviadoPara) {
    return (
      <div className="auth-form" role="status">
        <p className="auth-sub">Confira seu e-mail</p>
        <p className="detalhe-nota">
          Se <strong>{estado.enviadoPara}</strong> for válido, enviamos um link para confirmar a
          conta. Ele vence em uma hora. Não chegou? Olhe o spam.
        </p>
        <a className="btn" href="/entrar">
          Ir para o login
        </a>
      </div>
    );
  }

  const erroEm = (campo: string, outras?: string) =>
    comErro(estado.campo === campo, 'auth-erro', outras);

  return (
    <form action={acao} ref={form} className="auth-form" noValidate>
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

      <label className="auth-campo">
        <span>Senha</span>
        <input
          type="password"
          name="senha"
          autoComplete="new-password"
          minLength={SENHA_MIN}
          required
          disabled={pendente}
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          {...erroEm('senha', 'forca-da-senha')}
        />
      </label>

      {/* Sempre renderizada, mesmo vazia: aparecer e sumir empurraria o
          formulario a cada tecla. So `transform` anima. */}
      <div className="senha-forca" id="forca-da-senha" aria-live="polite">
        <div className="senha-barra" data-nivel={forca.nivel}>
          <i style={{ transform: `scaleX(${senha ? (forca.nivel + 1) / 5 : 0})` }} />
        </div>
        <span>{forca.rotulo}</span>
      </div>

      <label className="auth-campo">
        <span>Confirme a senha</span>
        <input
          type="password"
          name="confirmacao"
          autoComplete="new-password"
          required
          disabled={pendente}
          value={confirmacao}
          onChange={(e) => setConfirmacao(e.target.value)}
          {...erroEm('confirmacao')}
        />
      </label>

      {/* Desmarcada por padrao, e obrigatoria: o servidor recusa sem ela. O
          link abre em outra aba para nao perder o que ja foi digitado. */}
      <label className="auth-caixinha">
        <input
          type="checkbox"
          name="aceite"
          {...caixinha}
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

      <ContraRobo acao="criar-conta" tentativa={estado.tentativa} aoMudar={setRobo} />

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
        <Rotulo parado="Criar conta" agindo="Criando…" ativo={andando} />
      </button>

      <p className="auth-rodape">
        Já tem conta? <a href="/entrar">Entrar</a>
      </p>
    </form>
  );
}
