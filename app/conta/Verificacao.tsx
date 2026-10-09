'use client';

import CodigoDeConfirmacao from '@/app/_ui/CodigoDeConfirmacao';
import { CODIGO_DIGITOS } from '@/lib/esquemas';
import { confirmarCodigoDaConta, reenviarVerificacao } from './acoes';

/**
 * Aviso de e-mail nao verificado, com o campo do codigo (#260).
 *
 * O e-mail de cadastro so traz o codigo desde a #227. O botao que vivia aqui
 * mandava esse codigo e nao tinha onde digita-lo; agora o campo e o mesmo do
 * cadastro e do login. Com a configuracao de hoje o aviso nem aparece — ver
 * `reenviarVerificacao` —, e fica como defesa.
 *
 * Diferente das telas publicas: nada saiu quando a pagina abriu, entao o
 * botao de enviar comeca livre; o foco nao e roubado da pagina; e nao ha
 * desafio contra bot, porque a sessao ja diz quem pede.
 */
export default function Verificacao() {
  return (
    <CodigoDeConfirmacao
      classe="conta-codigo"
      intro={
        // So o que o codigo barra de fato: o checkout recusa conta sem e-mail
        // confirmado (app/checkout/acoes.ts). Recuperar a senha nao e barrado
        // — nem aqui, nem no Supabase, cujo link de recuperacao ainda
        // confirma o e-mail de quem o abre (#250).
        <>
          Seu e-mail ainda não foi verificado. Sem isso, não dá para comprar. Peça um código e
          digite aqui os {CODIGO_DIGITOS} dígitos.
        </>
      }
      confirmar={confirmarCodigoDaConta}
      reenviar={reenviarVerificacao}
      desafio={false}
      esperaInicialS={0}
      foco={false}
      rotuloDoReenvio="Enviar código"
    />
  );
}
