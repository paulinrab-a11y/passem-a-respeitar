'use client';

import CodigoDeConfirmacao from '@/app/_ui/CodigoDeConfirmacao';
import { confirmarCodigo, reenviarCodigo } from '@/app/criar-conta/acoes';
import { CODIGO_DIGITOS } from '@/lib/esquemas';

/**
 * O caminho de volta de quem saiu da tela do codigo do cadastro (#260).
 *
 * A tela do cadastro so existe no estado do formulario de /criar-conta:
 * recarregar, fechar a aba ou abrir o e-mail em outro aparelho a perdia, e o
 * codigo ficava sem lugar para ser digitado. Aqui ela volta pelo login, e so
 * para quem acertou a senha — ver `entrar` em ./acoes.ts.
 *
 * As acoes sao as do cadastro: o codigo e o mesmo. O que vai junto e o que o
 * login decidiu — para onde a pessoa ia (`next`, o checkout) e se a sessao e
 * para durar.
 *
 * `enviado` falso e cota de envio gasta ou o intervalo minimo do Supabase: o
 * texto diz que nada saiu agora, em vez de mandar esperar um e-mail. A
 * recuperacao fica no rodape nos dois casos, porque o link de la tambem
 * confirma o e-mail e nao depende de codigo nenhum.
 */
export default function Codigo({
  email,
  next,
  lembrar,
  enviado,
  aoVoltar,
}: {
  email: string;
  next: string;
  lembrar: boolean;
  enviado: boolean;
  aoVoltar: () => void;
}) {
  return (
    <CodigoDeConfirmacao
      titulo="Confirme seu e-mail"
      intro={
        enviado ? (
          <>
            Sua conta ainda não foi confirmada. Enviamos um código de {CODIGO_DIGITOS} dígitos para{' '}
            <strong>{email}</strong>; vale o mais recente, por uma hora. Não chegou? Olhe o spam.
          </>
        ) : (
          <>
            Sua conta ainda não foi confirmada. Não deu para mandar um código novo para{' '}
            <strong>{email}</strong> agora: use o último que chegou, se for de menos de uma hora, ou
            peça outro em instantes.
          </>
        )
      }
      confirmar={confirmarCodigo}
      reenviar={reenviarCodigo}
      ocultos={{ email, next, lembrar: lembrar ? '1' : '0' }}
      voltar={{ rotulo: 'Voltar', aoClicar: aoVoltar }}
    >
      <p className="auth-rodape">
        Sem o código? O link de <a href="/recuperar-senha">Esqueci minha senha</a> também confirma o
        e-mail.
      </p>
    </CodigoDeConfirmacao>
  );
}
