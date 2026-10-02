import { ambienteLocal } from './ambiente.mjs';
import { apagaUsuariosDaSuite, medeCamiseta } from './banco';
import { esvaziaCorreio } from './correio';

/**
 * Antes da suite: nada da rodada anterior no banco nem na caixa de e-mail.
 *
 * A primeira linha e a trava. Se o endereco do banco nao for desta maquina, a
 * suite para aqui, antes de apagar ou criar qualquer coisa.
 */
export default async function antes() {
  ambienteLocal();
  await apagaUsuariosDaSuite();
  await esvaziaCorreio();
  await medeCamiseta();
}
