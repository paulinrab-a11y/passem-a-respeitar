import { apagaUsuariosDaSuite } from './banco';
import { esvaziaCorreio } from './correio';

/** Depois da suite: o que ela criou sai com ela. */
export default async function depois() {
  await apagaUsuariosDaSuite();
  await esvaziaCorreio();
}
