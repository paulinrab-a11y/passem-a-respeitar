'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import ContraRobo, { SEM_AVISO } from '@/app/_ui/ContraRobo';
import { CAMPO_DA_ISCA } from '@/app/_ui/desafio';
import Erro from '@/app/_ui/Erro';
import Rotulo from '@/app/_ui/Rotulo';
import { DIGITOS_CODIGO } from '@/lib/esquemas';
import { confirmarCodigo, reenviarCodigo } from './acoes';
import { codigoInicial, reenvioInicial } from './estado';

/** O Supabase so manda outro e-mail depois de 60 s; a tela conta junto. */
export const ESPERA_REENVIO_S = 60;
const DIGITOS = DIGITOS_CODIGO;

/**
 * A tela do codigo (#224): o que aparece depois de "Criar conta".
 *
 * Um campo so, e nao oito caixinhas: colar funciona, o teclado do celular
 * preenche sozinho (`one-time-code`) e o leitor de tela le um campo. Quando o
 * oitavo digito entra, o formulario vai sozinho — ninguem precisa achar o
 * botao com o e-mail aberto do outro lado. O botao continua la para quem
 * digita devagar ou cola errado.
 *
 * O texto repete "se for válido": a tela e a mesma para e-mail novo e para
 * e-mail que ja tem conta, e por isso oferece o caminho de entrar.
 */
export default function Codigo({
  email,
  aoTrocarEmail,
}: {
  email: string;
  aoTrocarEmail: () => void;
}) {
  const [estado, confirmar, confirmando] = useActionState(confirmarCodigo, codigoInicial);
  const [reenvio, reenviar, reenviando] = useActionState(reenviarCodigo, reenvioInicial);
  const [codigo, setCodigo] = useState('');
  const form = useRef<HTMLFormElement>(null);
  const campo = useRef<HTMLInputElement>(null);
  const [robo, setRobo] = useState(SEM_AVISO);

  // Contagem do reenvio: comeca cheia (o primeiro e-mail acabou de sair) e
  // recomeca a cada reenvio que deu certo.
  const [restam, setRestam] = useState(ESPERA_REENVIO_S);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reenviadoEm reinicia a contagem
  useEffect(() => {
    setRestam(ESPERA_REENVIO_S);
    const id = setInterval(() => setRestam((r) => (r > 0 ? r - 1 : 0)), 1000);
    return () => clearInterval(id);
  }, [reenvio.reenviadoEm]);

  // Codigo errado: limpa e devolve o foco, para digitar o proximo sem apagar.
  // biome-ignore lint/correctness/useExhaustiveDependencies: tentativa marca cada resposta
  useEffect(() => {
    if (!estado.erro) return;
    setCodigo('');
    campo.current?.focus();
  }, [estado.tentativa]);

  function aoDigitar(valor: string) {
    // So digitos, no maximo oito: "Seu código: 1234 5678" colado vira 12345678.
    const limpo = valor.replace(/\D/g, '').slice(0, DIGITOS);
    setCodigo(limpo);
    if (limpo.length === DIGITOS && !confirmando) {
      // Espera o React gravar o valor no campo antes de enviar o formulario.
      queueMicrotask(() => form.current?.requestSubmit());
    }
  }

  const podeReenviar = restam === 0 && !reenviando && !robo.esperando;
  const recado = reenvio.erro ?? robo.aviso ?? reenvio.aviso;

  return (
    <div className="auth-form codigo-tela">
      <p className="auth-sub">Confira seu e-mail</p>
      <p className="detalhe-nota">
        Se <strong>{email}</strong> for válido, enviamos um código de {DIGITOS} dígitos. Ele vale
        por uma hora. Não chegou? Olhe o spam.
      </p>

      <form action={confirmar} ref={form} className="codigo-form" noValidate>
        <input type="hidden" name="email" value={email} />
        {/* A isca (#28), igual a da ContraRobo: fora da tela e do leitor. */}
        <div className="isca" aria-hidden="true">
          <label>
            Site
            <input type="text" name={CAMPO_DA_ISCA} tabIndex={-1} autoComplete="off" />
          </label>
        </div>
        <label className="auth-campo codigo-campo">
          <span>Código de {DIGITOS} dígitos</span>
          <input
            ref={campo}
            type="text"
            name="codigo"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern={`[0-9]{${DIGITOS}}`}
            maxLength={DIGITOS}
            required
            // biome-ignore lint/a11y/noAutofocus: a tela existe para este campo; o foco e o que a pessoa espera
            autoFocus
            disabled={confirmando}
            value={codigo}
            onChange={(e) => aoDigitar(e.target.value)}
            aria-invalid={estado.erro ? true : undefined}
            aria-describedby="codigo-erro"
          />
        </label>

        <Erro
          id="codigo-erro"
          texto={estado.erro}
          tentativa={estado.tentativa}
          enviando={confirmando}
        />

        <button
          type="submit"
          className={`btn auth-enviar${confirmando ? ' carregando' : ''}`}
          disabled={confirmando || codigo.length < DIGITOS}
        >
          <Rotulo parado="Confirmar" agindo="Confirmando…" ativo={confirmando} />
        </button>
      </form>

      <form action={reenviar} className="codigo-reenvio" noValidate>
        <input type="hidden" name="email" value={email} />
        <ContraRobo acao="reenviar-codigo" tentativa={reenvio.tentativa} aoMudar={setRobo} />
        <Erro
          id="reenvio-recado"
          texto={recado}
          tentativa={robo.aviso ? `robo-${robo.vez}` : reenvio.tentativa}
          enviando={reenviando}
          classe={reenvio.erro || robo.aviso ? 'auth-erro' : 'auth-erro auth-aviso'}
        />
        <div className="codigo-acoes">
          <button
            type="submit"
            className={`btn${reenviando || robo.esperando ? ' carregando' : ''}`}
            disabled={!podeReenviar}
          >
            <Rotulo
              parado={restam > 0 ? `Reenviar código (${restam} s)` : 'Reenviar código'}
              agindo="Enviando…"
              ativo={reenviando || robo.esperando}
            />
          </button>
          <button type="button" className="btn" onClick={aoTrocarEmail}>
            Trocar e-mail
          </button>
        </div>
      </form>

      <p className="auth-rodape">
        Já tem conta com esse e-mail? <a href="/entrar">Entrar</a>
      </p>
    </div>
  );
}
