'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Rotulo from '@/app/_ui/Rotulo';
import { useDesmonteAnimado } from './desmonte-animado';
import Mensagem from './Mensagem';

/**
 * Modal de reautenticacao (Issue #40).
 *
 * Aparece quando a acao responde que a janela venceu. Ao confirmar a senha,
 * chama de volta quem pediu — e a acao original recomeca com os MESMOS dados,
 * sem a pessoa redigitar nada.
 *
 * O portal e pelo mesmo motivo do menu da barra: modal precisa ficar acima de
 * tudo, e dentro do fluxo da pagina ele herda `overflow`, `transform` e
 * empilhamento de quem esta em volta.
 */
export default function Reautenticar({
  aberto,
  onCancelar,
  onConfirmar,
  erro,
  pendente,
  minutos,
}: {
  aberto: boolean;
  onCancelar: () => void;
  onConfirmar: (senha: string) => void;
  erro: string | null;
  pendente: boolean;
  /** Por prop, e nao importada: a constante mora num modulo server-only. */
  minutos: number;
}) {
  const { montado, saindo, abrir, fechar, aoFimDaAnimacao } = useDesmonteAnimado(400);
  const [senha, setSenha] = useState('');
  const campo = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (aberto) abrir();
    else fechar();
  }, [aberto, abrir, fechar]);

  // Foco no campo assim que o modal monta: a pessoa foi interrompida no meio
  // de outra coisa, e o minimo e nao obrigar ela a procurar onde digitar.
  useEffect(() => {
    if (montado) campo.current?.focus();
  }, [montado]);

  useEffect(() => {
    if (!montado) return;

    function noTeclado(e: KeyboardEvent) {
      if (e.key === 'Escape' && !pendente) onCancelar();
    }
    document.addEventListener('keydown', noTeclado);
    return () => document.removeEventListener('keydown', noTeclado);
  }, [montado, pendente, onCancelar]);

  if (!montado) return null;

  return createPortal(
    <div
      className={`modal${saindo ? ' saindo' : ''}`}
      onAnimationEnd={aoFimDaAnimacao}
      role="dialog"
      aria-modal="true"
      aria-labelledby="reauth-titulo"
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: o fundo fecha ao clique; Escape e o caminho de teclado, tratado acima */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: idem */}
      <div className="modal-fundo" onClick={() => !pendente && onCancelar()} />

      <div className="modal-caixa">
        <h2 id="reauth-titulo">Confirme que é você</h2>
        <p>Faz mais de {minutos} minutos desde o seu login. Para continuar, digite sua senha.</p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            onConfirmar(senha);
          }}
        >
          <label className="auth-campo">
            <span>Senha</span>
            <input
              ref={campo}
              type="password"
              autoComplete="current-password"
              required
              disabled={pendente}
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
            />
          </label>

          <Mensagem texto={erro} chave={erro ?? ''} classe="conta-recado erro" papel="alert" />

          <div className="modal-acoes">
            <button
              type="submit"
              className={`btn${pendente ? ' carregando' : ''}`}
              disabled={pendente}
            >
              <Rotulo parado="Confirmar" agindo="Confirmando…" ativo={pendente} />
            </button>
            <button type="button" className="auth-link" onClick={onCancelar} disabled={pendente}>
              Cancelar
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
