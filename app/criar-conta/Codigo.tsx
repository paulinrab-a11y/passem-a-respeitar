'use client';

import CodigoDeConfirmacao from '@/app/_ui/CodigoDeConfirmacao';
import { CODIGO_DIGITOS } from '@/lib/esquemas';
import { confirmarCodigo, reenviarCodigo } from './acoes';

/**
 * A tela do codigo (#224): o que aparece depois de "Criar conta". O campo e
 * o reenvio sao os de `CodigoDeConfirmacao`, os mesmos do login (#260).
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
  return (
    <CodigoDeConfirmacao
      titulo="Confira seu e-mail"
      intro={
        <>
          Se <strong>{email}</strong> for válido, enviamos um código de {CODIGO_DIGITOS} dígitos.
          Ele vale por uma hora. Não chegou? Olhe o spam.
        </>
      }
      confirmar={confirmarCodigo}
      reenviar={reenviarCodigo}
      ocultos={{ email }}
      voltar={{ rotulo: 'Trocar e-mail', aoClicar: aoTrocarEmail }}
    >
      <p className="auth-rodape">
        Já tem conta com esse e-mail? <a href="/entrar">Entrar</a>
      </p>
      {/* Esta tela some ao recarregar ou fechar a aba. A volta e o login com a
          senha, e nao cadastrar de novo, que descartaria a senha nova (#260). */}
      <p className="auth-rodape">
        Se sair desta tela antes de confirmar, entre com a senha que escolheu: mandamos um código
        novo.
      </p>
    </CodigoDeConfirmacao>
  );
}
