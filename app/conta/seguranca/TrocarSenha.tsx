'use client';

import { useActionState, useEffect, useState } from 'react';
import { useDesmonteAnimado } from '@/app/_ui/desmonte-animado';
import { useSaidaAutomatica } from '@/app/_ui/saida-automatica';
import { forcaDaSenha, SENHA_MIN } from '@/lib/conta/senha';
import { trocarSenha } from './acoes';
import { senhaInicial } from './estado';

export default function TrocarSenha() {
  const [estado, acao, pendente] = useActionState(trocarSenha, senhaInicial);
  const [nova, setNova] = useState('');
  const forca = forcaDaSenha(nova);

  const { montado: aviso, saindo, abrir, fechar, aoFimDaAnimacao } = useDesmonteAnimado(400);

  // O toast entra quando a acao responde.
  //
  // Reaparece quando a mesma mensagem acontece duas vezes seguidas porque a
  // acao devolve um `recado` novo a cada resposta — a identidade do objeto
  // muda, e o efeito roda de novo mesmo com o texto identico.
  useEffect(() => {
    if (estado.recado) abrir();
  }, [estado.recado, abrir]);

  // E sai sozinho, erro incluido (#136).
  const { pausar, retomar } = useSaidaAutomatica(estado.recado, aviso, fechar);

  return (
    <>
      <form action={acao} className="conta-bloco" autoComplete="on">
        <label className="auth-campo">
          <span>Senha atual</span>
          <input
            type="password"
            name="atual"
            autoComplete="current-password"
            required
            disabled={pendente}
          />
        </label>

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
            aria-describedby="forca-da-senha"
          />
        </label>

        {/* A barra e sempre renderizada, mesmo vazia: aparecer e sumir
            empurraria o resto do formulario para baixo a cada tecla. */}
        <div className="senha-forca" id="forca-da-senha">
          <div className="senha-barra" data-nivel={forca.nivel}>
            <i style={{ transform: `scaleX(${nova ? (forca.nivel + 1) / 5 : 0})` }} />
          </div>
          <span aria-live="polite">{forca.rotulo}</span>
        </div>

        <label className="auth-campo">
          <span>Confirmar nova senha</span>
          <input
            type="password"
            name="confirmacao"
            autoComplete="new-password"
            required
            disabled={pendente}
          />
        </label>

        <button
          type="submit"
          className={`btn auth-enviar${pendente ? ' carregando' : ''}`}
          disabled={pendente}
        >
          {pendente ? 'Trocando…' : 'Trocar senha'}
        </button>
      </form>

      {aviso && estado.recado ? (
        <div
          className={`toast ${estado.recado.tom}${saindo ? ' saindo' : ''}`}
          onAnimationEnd={aoFimDaAnimacao}
          onMouseEnter={pausar}
          onMouseLeave={retomar}
          onFocus={pausar}
          onBlur={retomar}
          role="status"
        >
          <p>{estado.recado.texto}</p>
          <button type="button" onClick={fechar} aria-label="Fechar aviso">
            ×
          </button>
        </div>
      ) : null}
    </>
  );
}
