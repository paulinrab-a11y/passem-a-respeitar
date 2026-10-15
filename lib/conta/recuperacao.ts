import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';
import { RECUPERACAO_SEGUNDOS } from '@/lib/supabase/cookies';

/**
 * A marca `par_recuperacao` assinada e presa a uma conta (#348).
 *
 * Antes o valor era `1`: qualquer sessao que encontrasse o cookie no
 * navegador trocava a senha sem a atual. O cookie sobrevivia ao "Sair", e
 * quem entrasse em seguida no mesmo navegador, com OUTRA conta, herdava a
 * permissao. Agora o valor e `v1.<id da conta>.<vence em>.<hmac>`, e
 * /redefinir-senha so aceita se o id for o da sessao atual e o HMAC conferir.
 *
 * O segredo e a SUPABASE_SECRET_KEY, que o servidor ja tem em todo ambiente
 * em que ha login (o admin depende dela), e nao uma variavel nova. Ela nao
 * assina nada diretamente: dela se deriva uma chave so desta marca, entao
 * nada que se assine aqui serve para outro uso, e o valor da chave nunca sai
 * do servidor. Trocar a chave invalida as marcas abertas, que vivem meia
 * hora — custa um link novo, nada mais.
 *
 * Sem a chave a marca nao nasce, e sem marca nao ha redefinicao: falha
 * fechada, como o cookie do convite.
 */

const VERSAO = 'v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function chave() {
  const segredo = process.env.SUPABASE_SECRET_KEY;
  if (!segredo) return null;
  return createHmac('sha256', segredo).update('par_recuperacao').digest();
}

function assina(corpo: string, k: Buffer) {
  return createHmac('sha256', k).update(corpo).digest('hex');
}

/** Valor do cookie para a conta `usuarioId`, ou null sem segredo ou id torto. */
export function criaMarcaDeRecuperacao(
  usuarioId: string,
  agoraS = Math.floor(Date.now() / 1000)
): string | null {
  const k = chave();
  if (!k || !UUID.test(usuarioId)) return null;

  const corpo = `${VERSAO}.${usuarioId.toLowerCase()}.${agoraS + RECUPERACAO_SEGUNDOS}`;
  return `${corpo}.${assina(corpo, k)}`;
}

/**
 * A marca vale para esta conta, agora? Valor forjado, vencido, de outra conta
 * ou no formato antigo (`1`) da false.
 */
export function marcaDeRecuperacaoConfere(
  valor: string | undefined,
  usuarioId: string,
  agoraMs = Date.now()
): boolean {
  const k = chave();
  if (!k || !valor) return false;

  const partes = valor.split('.');
  if (partes.length !== 4 || partes[0] !== VERSAO) return false;
  const [, id, vence, hmac] = partes;

  if (id !== usuarioId.toLowerCase()) return false;
  const venceS = Number(vence);
  if (!Number.isSafeInteger(venceS) || venceS * 1000 <= agoraMs) return false;

  const esperado = Buffer.from(assina(`${VERSAO}.${id}.${vence}`, k), 'hex');
  const recebido = Buffer.from(hmac, 'hex');
  // Comparacao em tempo constante: `===` vazaria, pelo tempo, quanto do HMAC
  // bateu. O tamanho diferente sai antes, e isso nao revela nada do segredo.
  return recebido.length === esperado.length && timingSafeEqual(recebido, esperado);
}
