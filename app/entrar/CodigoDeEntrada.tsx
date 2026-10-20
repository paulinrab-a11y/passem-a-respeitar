'use client';

import CodigoDeConfirmacao from '@/app/_ui/CodigoDeConfirmacao';
import { CODIGO_DIGITOS } from '@/lib/conta/codigo-digitos';
import { entrarComCodigo, reenviarCodigoDeEntrada } from './acoes-codigo';

/**
 * A tela do codigo de quem entra sem senha (#387). O campo, o reenvio e a
 * espera sao os de `CodigoDeConfirmacao`, os mesmos do cadastro.
 *
 * O texto e o mesmo para e-mail com conta e sem conta: "se for valido". O
 * que vai junto nos dois envios e o que o pedido decidiu — o destino (`next`,
 * o checkout com o item escolhido), o "manter conectado" e o aceite, que o
 * reenvio confere de novo porque tambem pode criar a conta.
 */
export default function CodigoDeEntrada({
  email,
  next,
  lembrar,
  aoTrocarEmail,
}: {
  email: string;
  next: string;
  lembrar: boolean;
  aoTrocarEmail: () => void;
}) {
  return (
    <CodigoDeConfirmacao
      titulo="Confira seu e-mail"
      intro={
        <>
          Se <strong>{email}</strong> for válido, enviamos um código de {CODIGO_DIGITOS} dígitos.
          Ele vale por uma hora. Não chegou? Olhe o spam.
        </>
      }
      confirmar={entrarComCodigo}
      reenviar={reenviarCodigoDeEntrada}
      ocultos={{ email, next, lembrar: lembrar ? '1' : '0', aceite: 'on' }}
      voltar={{ rotulo: 'Trocar e-mail', aoClicar: aoTrocarEmail }}
    />
  );
}
