'use client';

import CodigoDeConfirmacao from '@/app/_ui/CodigoDeConfirmacao';
import type { EstadoCodigo } from '@/app/_ui/estado-do-codigo';
import { CODIGO_DIGITOS } from '@/lib/esquemas';
import { confirmarCadastro, reenviarCodigo } from './acoes';

/**
 * A tela do codigo (#224): o que aparece depois de "Criar conta". O campo e
 * o reenvio sao os de `CodigoDeConfirmacao`, os mesmos do login (#260).
 *
 * O texto repete "se for válido": a tela e a mesma para e-mail novo e para
 * e-mail que ja tem conta, e por isso oferece o caminho de entrar.
 *
 * A senha que a pessoa acabou de escolher vai junto com o codigo, e so com
 * ele (#284): confirmar grava essa senha na conta, porque a conta pendente
 * pode ter nascido com a senha de outra pessoa. Ela vem do estado do
 * formulario e entra no envio na hora, em vez de num campo oculto: nao fica
 * no HTML da pagina, nao vai no reenvio e nao e guardada em lugar nenhum do
 * navegador.
 */
export default function Codigo({
  email,
  senha,
  confirmacao,
  aoTrocarEmail,
}: {
  email: string;
  senha: string;
  confirmacao: string;
  aoTrocarEmail: () => void;
}) {
  function confirmar(anterior: EstadoCodigo, form: FormData) {
    form.set('senha', senha);
    form.set('confirmacao', confirmacao);
    return confirmarCadastro(anterior, form);
  }

  return (
    <CodigoDeConfirmacao
      titulo="Confira seu e-mail"
      intro={
        <>
          Se <strong>{email}</strong> for válido, enviamos um código de {CODIGO_DIGITOS} dígitos.
          Ele vale por uma hora. Não chegou? Olhe o spam.
        </>
      }
      confirmar={confirmar}
      reenviar={reenviarCodigo}
      ocultos={{ email }}
      voltar={{ rotulo: 'Trocar e-mail', aoClicar: aoTrocarEmail }}
    >
      <p className="auth-rodape">
        Já tem conta com esse e-mail? <a href="/entrar">Entrar</a>
      </p>
      {/* Esta tela some ao recarregar ou fechar a aba, e com ela a senha que
          o codigo gravaria. A volta e o login com a senha (#260). */}
      <p className="auth-rodape">
        Se sair desta tela antes de confirmar, entre com a senha que escolheu: mandamos um código
        novo.
      </p>
    </CodigoDeConfirmacao>
  );
}
