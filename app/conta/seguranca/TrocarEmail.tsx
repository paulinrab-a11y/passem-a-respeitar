'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { useCampos } from '@/app/_ui/campos';
import { cancelarTrocaDeEmail, trocarEmail } from './email';
import { cancelamentoInicial, type EstadoEmail, emailInicial } from './estado-email';

/**
 * Troca de e-mail (Issue #36).
 *
 * Duas caras, decididas pelo SERVIDOR: `pendente` vem do usuario da sessao,
 * nao de estado da tela nem de parametro na URL. Com troca pendente, a tela
 * mostra para onde e oferece cancelar; sem, mostra o formulario.
 */
export default function TrocarEmail({
  atual,
  pendente: paraOnde,
}: {
  atual: string;
  pendente: string | null;
}) {
  const [estado, acao, enviando] = useActionState(trocarEmail, emailInicial);
  const [cancelamento, acaoCancelar, cancelando] = useActionState(
    cancelarTrocaDeEmail,
    cancelamentoInicial
  );
  const { campo, limpar } = useCampos({ email: '', senha: '' });
  const form = useRef<HTMLFormElement>(null);

  // Pedido aceito: a senha nao fica parada num formulario que ja cumpriu o
  // papel. No erro, os dois campos ficam (#130).
  useEffect(() => {
    if (estado.recado?.tom === 'ok') limpar();
  }, [estado.recado, limpar]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: tentativa reanima o foco quando o mesmo campo erra de novo
  useEffect(() => {
    if (!estado.campo) return;
    const alvo = form.current?.elements.namedItem(estado.campo);
    if (alvo instanceof HTMLInputElement) alvo.focus();
  }, [estado.campo, estado.tentativa]);

  // O recado mais recente vence: quem acabou de cancelar nao precisa reler o
  // "mandamos dois links" do pedido que cancelou, e vice-versa. Cada resposta
  // de acao traz um objeto novo, e e isso que dispara o efeito.
  const [recado, setRecado] = useState<EstadoEmail['recado']>(null);
  useEffect(() => {
    if (estado.recado) setRecado(estado.recado);
  }, [estado.recado]);
  useEffect(() => {
    if (cancelamento.recado) setRecado(cancelamento.recado);
  }, [cancelamento.recado]);

  return (
    <section className="troca-email">
      <h2>E-mail da conta</h2>
      <p className="troca-email-atual">{atual}</p>

      {paraOnde ? (
        <div className="troca-email-pendente" role="status">
          <p>
            Troca pendente para <strong>{paraOnde}</strong>.
          </p>
          <p className="sessoes-nota">
            Mandamos um link para cada endereço. O e-mail só muda depois que os dois forem
            confirmados; até lá, o login continua no atual. Os links vencem em uma hora.
          </p>

          <form action={acaoCancelar}>
            <button type="submit" className="auth-link" disabled={cancelando}>
              {cancelando ? 'Cancelando…' : 'Cancelar a troca'}
            </button>
          </form>
        </div>
      ) : (
        <form action={acao} ref={form} className="conta-bloco" noValidate>
          <label className="auth-campo">
            <span>Novo e-mail</span>
            <input
              type="email"
              {...campo('email')}
              autoComplete="email"
              required
              disabled={enviando}
              aria-invalid={estado.campo === 'email' ? true : undefined}
            />
          </label>

          <label className="auth-campo">
            <span>Sua senha, para confirmar</span>
            <input
              type="password"
              {...campo('senha')}
              autoComplete="current-password"
              required
              disabled={enviando}
              aria-invalid={estado.campo === 'senha' ? true : undefined}
            />
          </label>

          <button
            type="submit"
            className={`btn auth-enviar${enviando ? ' carregando' : ''}`}
            disabled={enviando}
          >
            {enviando ? 'Enviando…' : 'Trocar e-mail'}
          </button>
        </form>
      )}

      {/* Com a troca pendente na tela, o "mandamos dois links" do pedido seria
          a mesma frase duas vezes. Erro e cancelamento continuam aparecendo. */}
      {recado && !(paraOnde && recado === estado.recado && recado.tom === 'ok') ? (
        <p
          key={`${estado.tentativa}-${recado.texto}`}
          className={`conta-recado ${recado.tom}`}
          role={recado.tom === 'erro' ? 'alert' : 'status'}
        >
          {recado.texto}
        </p>
      ) : null}
    </section>
  );
}
