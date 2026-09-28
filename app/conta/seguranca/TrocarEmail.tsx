'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { comErro, useCampos } from '@/app/_ui/campos';
import Mensagem from '@/app/_ui/Mensagem';
import Rotulo from '@/app/_ui/Rotulo';
import { useTrocaComSaida } from '@/app/_ui/troca-com-saida';
import { cancelarTrocaDeEmail, trocarEmail } from './email';
import { cancelamentoInicial, type EstadoEmail, emailInicial } from './estado-email';

/**
 * Troca de e-mail (Issue #36).
 *
 * Duas caras, decididas pelo SERVIDOR: `pendente` vem do usuario da sessao,
 * nao de estado da tela nem de parametro na URL. Com troca pendente, a tela
 * mostra para onde e oferece cancelar; sem, mostra o formulario.
 *
 * A troca de uma cara pela outra tem saida (#155): a que estava na tela sai
 * com fade, e so entao a outra entra. O endereco pendente fica guardado
 * durante a saida — cancelar zera a prop na hora, e sem isso o bloco sairia
 * dizendo "troca pendente para" ninguem.
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
  // de acao traz um objeto novo, e e por ele que se sabe qual das duas respondeu.
  //
  // Decidido no render, e nao num efeito (#155). Efeito roda depois de a tela
  // ser desenhada: no quadro da resposta do cancelamento o recado ainda era o
  // do pedido, que aparecia e era trocado em seguida. Era um quadro; com a
  // saida animada viraria um recado velho inteiro, entrando e saindo.
  const [visto, setVisto] = useState<{
    pedido: EstadoEmail['recado'];
    cancelamento: EstadoEmail['recado'];
    pendente: string | null;
    recado: EstadoEmail['recado'];
  }>({
    pedido: estado.recado,
    cancelamento: cancelamento.recado,
    pendente: paraOnde,
    recado: null,
  });

  if (
    estado.recado !== visto.pedido ||
    cancelamento.recado !== visto.cancelamento ||
    paraOnde !== visto.pendente
  ) {
    let novo = visto.recado;

    // A troca pendente saiu da tela — cancelada, confirmada ou vencida. O
    // "mandamos dois links" falava dela, e era ela que o escondia: sem isto
    // ele reapareceria agora, falando de links que nao valem mais.
    if (visto.pendente && !paraOnde && novo === visto.pedido && novo?.tom === 'ok') novo = null;

    // Resposta sem recado nao apaga o que esta na tela.
    if (estado.recado !== visto.pedido && estado.recado) novo = estado.recado;
    if (cancelamento.recado !== visto.cancelamento && cancelamento.recado) {
      novo = cancelamento.recado;
    }

    setVisto({
      pedido: estado.recado,
      cancelamento: cancelamento.recado,
      pendente: paraOnde,
      recado: novo,
    });
  }
  const { recado } = visto;

  const {
    mostrado: pendenteNaTela,
    saindo,
    aoFimDaAnimacao,
  } = useTrocaComSaida(paraOnde, {
    // `null` aqui nao e "nada na tela": e o formulario, que tambem tem saida.
    vazio: () => false,
    limiteMs: 220,
  });
  const deSaida = saindo ? ' saindo' : '';

  // Entrada so para o formulario que voltou depois de uma troca. Na carga da
  // pagina ele ja vem dentro da entrada da propria pagina, e duas entradas
  // uma dentro da outra somam.
  const [trocou, setTrocou] = useState(false);
  useEffect(() => {
    if (saindo) setTrocou(true);
  }, [saindo]);
  const deEntrada = trocou && !saindo ? ' entrou' : '';

  return (
    <section className="troca-email">
      <h2>E-mail da conta</h2>
      <p className="troca-email-atual">{atual}</p>

      {pendenteNaTela ? (
        <div
          className={`troca-email-pendente${deSaida}`}
          role="status"
          onAnimationEnd={aoFimDaAnimacao}
        >
          <p>
            Troca pendente para <strong>{pendenteNaTela}</strong>.
          </p>
          <p className="sessoes-nota">
            Mandamos um link para cada endereço. O e-mail só muda depois que os dois forem
            confirmados; até lá, o login continua no atual. Os links vencem em uma hora.
          </p>

          <form action={acaoCancelar}>
            <button
              type="submit"
              className={`auth-link${cancelando ? ' carregando' : ''}`}
              disabled={cancelando}
            >
              <Rotulo parado="Cancelar a troca" agindo="Cancelando…" ativo={cancelando} />
            </button>
          </form>
        </div>
      ) : (
        <form
          action={acao}
          ref={form}
          className={`conta-bloco troca-email-form${deEntrada}${deSaida}`}
          onAnimationEnd={aoFimDaAnimacao}
          noValidate
        >
          <label className="auth-campo">
            <span>Novo e-mail</span>
            <input
              type="email"
              {...campo('email')}
              autoComplete="email"
              required
              disabled={enviando}
              {...comErro(estado.campo === 'email', 'recado-do-email')}
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
              {...comErro(estado.campo === 'senha', 'recado-do-email')}
            />
          </label>

          <button
            type="submit"
            className={`btn auth-enviar${enviando ? ' carregando' : ''}`}
            disabled={enviando}
          >
            <Rotulo parado="Trocar e-mail" agindo="Enviando…" ativo={enviando} />
          </button>
        </form>
      )}

      {/* Lugar reservado (#51): o recado entra sem empurrar a lista de
          aparelhos que vem logo abaixo.
          Com a troca pendente na tela, o "mandamos dois links" do pedido seria
          a mesma frase duas vezes. Erro e cancelamento continuam aparecendo. */}
      <div className="erro-vaga">
        <Mensagem
          id="recado-do-email"
          texto={
            recado && !(paraOnde && recado === estado.recado && recado.tom === 'ok')
              ? recado.texto
              : null
          }
          chave={`${estado.tentativa}-${recado?.texto ?? ''}`}
          classe={`conta-recado ${recado?.tom ?? 'ok'}`}
          papel={recado?.tom === 'erro' ? 'alert' : 'status'}
          // O lugar e reservado: o recado do envio anterior pode sair na hora
          // do envio sem que nada abaixo se mova.
          enviando={enviando || cancelando}
        />
      </div>
    </section>
  );
}
