import { apagaUsuariosDaSuite } from './banco';
import { esvaziaCorreio } from './correio';

/** Antes da suite: nada da rodada anterior no banco nem na caixa de e-mail. */
export default async function antes() {
  await apagaUsuariosDaSuite();
  await esvaziaCorreio();
}
