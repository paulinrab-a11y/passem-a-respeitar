'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Rotulo from '@/app/_ui/Rotulo';
import { useDesmonteAnimado } from './desmonte-animado';
import { prendeFundo, soltaFundo } from './fundo-inerte';
import Mensagem from './Mensagem';

/** Quem segura o fundo inerte enquanto o modal esta na tela. */
const DONO = 'reautenticar';

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
 *
 * Desde a #270 e modal tambem para o teclado: na tela, o resto da pagina e
 * inerte; ao sair, o foco volta para onde a pessoa estava.
 */
export default function Reautenticar({
  aberto,
  onCancelar,
  onConfirmar,
  erro,
  pendente,
  minutos,
  devolverFoco,
}: {
  aberto: boolean;
  onCancelar: () => void;
  onConfirmar: (senha: string) => void;
  erro: string | null;
  pendente: boolean;
  /** Por prop, e nao importada: a constante mora num modulo server-only. */
  minutos: number;
  /**
   * Para onde o foco vai quando o modal sai. Sem isto, volta para o que estava
   * focado quando ele abriu — o que nem sempre existe: o botao que disparou a
   * acao costuma ficar desabilitado enquanto ela roda, e o navegador tira o
   * foco dele nesse instante.
   */
  devolverFoco?: () => HTMLElement | null;
}) {
  const { montado, saindo, abrir, fechar, aoFimDaAnimacao } = useDesmonteAnimado(400);
  const [senha, setSenha] = useState('');
  const campo = useRef<HTMLInputElement>(null);
  const modal = useRef<HTMLDivElement>(null);
  // O destino e lido na saida, nao na entrada: a lista atras do modal pode ter
  // mudado enquanto ele estava aberto (a linha encerrada sai dela).
  const destino = useRef(devolverFoco);
  useEffect(() => {
    destino.current = devolverFoco;
  });

  useEffect(() => {
    if (aberto) abrir();
    else fechar();
  }, [aberto, abrir, fechar]);

  // Antes do efeito que foca o campo: o que estava focado e lido aqui, antes
  // de o foco entrar no modal. Na saida, o fundo volta antes do foco — elemento
  // inerte nao recebe foco.
  useEffect(() => {
    if (!montado) return;

    const ativo = document.activeElement;
    const antes = ativo instanceof HTMLElement && ativo !== document.body ? ativo : null;
    if (modal.current) prendeFundo(modal.current, DONO);

    return () => {
      soltaFundo(document, DONO);
      const alvo = destino.current?.() ?? antes;
      if (alvo?.isConnected) alvo.focus();
    };
  }, [montado]);

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
      ref={modal}
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
