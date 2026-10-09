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
 */
export default function Codigo({
  email,
  next,
  lembrar,
  aoVoltar,
}: {
  email: string;
  next: string;
  lembrar: boolean;
  aoVoltar: () => void;
}) {
  return (
    <CodigoDeConfirmacao
      titulo="Confirme seu e-mail"
      intro={
        <>
          Sua conta ainda não foi confirmada. Enviamos um código de {CODIGO_DIGITOS} dígitos para{' '}
          <strong>{email}</strong>; vale o mais recente, por uma hora. Não chegou? Olhe o spam.
        </>
      }
      confirmar={confirmarCodigo}
      reenviar={reenviarCodigo}
      ocultos={{ email, next, lembrar: lembrar ? '1' : '0' }}
      voltar={{ rotulo: 'Voltar', aoClicar: aoVoltar }}
    />
  );
}
