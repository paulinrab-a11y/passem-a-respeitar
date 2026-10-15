/**
 * Piso de tempo das acoes que mandam e-mail de conta (#352).
 *
 * Recuperar senha, criar conta e reenviar codigo ja respondem o MESMO texto
 * exista a conta ou nao. O tempo ainda contava: o Supabase devolve mais
 * rapido quando nao tem e-mail para mandar (conta inexistente na
 * recuperacao, e-mail ja cadastrado no cadastro), e quem mede a resposta
 * separa os dois casos. Com um piso acima do tempo normal de envio, os dois
 * caminhos levam o mesmo tempo para quem esta medindo.
 *
 * O login tem o seu (LOGIN_PISO_MS, app/entrar/acoes.ts), mais curto: la
 * nao ha e-mail no caminho, so a conferencia do hash.
 *
 * Lido por request, e nao no topo do modulo, para o teste poder zerar sem
 * esperar de verdade.
 */
const pisoMs = () => Number(process.env.CONTA_PISO_MS ?? 1500);

/** Espera ate `inicio + piso`. Nao faz nada se a acao ja demorou mais que isso. */
export async function seguraAtePiso(inicio: number) {
  const resto = inicio + pisoMs() - Date.now();
  if (resto > 0) await new Promise((r) => setTimeout(r, resto));
}
