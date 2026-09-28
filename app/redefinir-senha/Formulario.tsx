'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { comErro } from '@/app/_ui/campos';
import Erro from '@/app/_ui/Erro';
import Rotulo from '@/app/_ui/Rotulo';
import { forcaDaSenha, SENHA_MIN } from '@/lib/conta/senha';
import { redefinirSenha } from './acoes';
import { redefinirInicial } from './estado';

export default function Formulario() {
  const [estado, acao, pendente] = useActionState(redefinirSenha, redefinirInicial);
  // Controlados: senha nunca volta do servidor, e o React 19 apagaria os
  // campos quando a acao respondesse com erro (#130).
  const [nova, setNova] = useState('');
  const [confirmacao, setConfirmacao] = useState('');
  const forca = forcaDaSenha(nova);
  const form = useRef<HTMLFormElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: tentativa reanima o foco quando o mesmo campo erra de novo
  useEffect(() => {
    if (!estado.campo) return;
    const alvo = form.current?.elements.namedItem(estado.campo);
    if (alvo instanceof HTMLInputElement) alvo.focus();
  }, [estado.campo, estado.tentativa]);

  return (
    <form action={acao} ref={form} className="auth-form" noValidate>
      <label className="auth-campo">
        <span>Nova senha</span>
        <input
          type="password"
          name="nova"
          autoComplete="new-password"
          minLength={SENHA_MIN}
          required
          disabled={pendente}
          value={nova}
          onChange={(e) => setNova(e.target.value)}
          {...comErro(estado.campo === 'nova', 'auth-erro', 'forca-da-senha')}
        />
      </label>

      <div className="senha-forca" id="forca-da-senha" aria-live="polite">
        <div className="senha-barra" data-nivel={forca.nivel}>
          <i style={{ transform: `scaleX(${nova ? (forca.nivel + 1) / 5 : 0})` }} />
        </div>
        <span>{forca.rotulo}</span>
      </div>

      <label className="auth-campo">
        <span>Confirme a nova senha</span>
        <input
          type="password"
          name="confirmacao"
          autoComplete="new-password"
          required
          disabled={pendente}
          value={confirmacao}
          onChange={(e) => setConfirmacao(e.target.value)}
          {...comErro(estado.campo === 'confirmacao', 'auth-erro')}
        />
      </label>

      <Erro id="auth-erro" texto={estado.erro} tentativa={estado.tentativa} />

      <button
        type="submit"
        className={`btn auth-enviar${pendente ? ' carregando' : ''}`}
        disabled={pendente}
      >
        <Rotulo parado="Salvar nova senha" agindo="Salvando…" ativo={pendente} />
      </button>
    </form>
  );
}
