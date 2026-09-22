/**
 * Validacao dos codigos de convite. Tudo aqui roda no servidor.
 *
 * Antes desta Issue (#13) os codigos estavam em texto puro no JS do cliente e
 * a comparacao acontecia no navegador: qualquer visitante abria o view-source,
 * lia `RESPEITO` e `PAR2026` e entrava. O "exclusivo" nao era exclusivo.
 *
 * Agora o servidor guarda apenas o SHA-256 de cada codigo e o conteudo
 * protegido (o embed do teaser) so sai daqui depois que o codigo confere.
 */

const enc = new TextEncoder();

/** Duracao do cookie de acesso. */
const VALIDADE_S = 60 * 60 * 24 * 30; // 30 dias

export const COOKIE_CONVITE = 'par_convite';

function hex(buf: ArrayBuffer) {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function sha256Hex(valor: string) {
  return hex(await crypto.subtle.digest('SHA-256', enc.encode(valor)));
}

/**
 * Comparacao em tempo constante. Comparar hash com `===` vaza, pelo tempo de
 * resposta, quantos caracteres iniciais bateram, e isso da para explorar.
 */
function igualTempoConstante(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function hashesConfigurados() {
  return (process.env.CONVITE_CODIGOS_HASH ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter((h) => /^[0-9a-f]{64}$/.test(h));
}

/** Confere o codigo contra a lista de hashes. Nunca recebe nem devolve o codigo. */
export async function codigoConfere(codigo: string) {
  const lista = hashesConfigurados();
  if (lista.length === 0) return false;

  const alvo = await sha256Hex(codigo);

  // Percorre a lista inteira de proposito, sem sair no primeiro acerto: assim
  // o tempo de resposta nao depende da posicao do codigo na lista.
  let achou = false;
  for (const h of lista) {
    if (igualTempoConstante(alvo, h)) achou = true;
  }
  return achou;
}

async function chaveHmac(segredo: string) {
  return crypto.subtle.importKey(
    'raw',
    enc.encode(segredo),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
}

async function assina(msg: string, segredo: string) {
  const sig = await crypto.subtle.sign('HMAC', await chaveHmac(segredo), enc.encode(msg));
  return hex(sig);
}

/**
 * Valor do cookie de acesso: `v1.<expiracao>.<hmac>`.
 * Assinado para que ninguem forje o cookie e entre sem codigo.
 */
export async function criaCookie(agoraS = Math.floor(Date.now() / 1000)) {
  const segredo = process.env.CONVITE_COOKIE_SECRET;
  if (!segredo) return null;

  const exp = agoraS + VALIDADE_S;
  const corpo = `v1.${exp}`;
  return { valor: `${corpo}.${await assina(corpo, segredo)}`, maxAge: VALIDADE_S };
}

export async function cookieValido(valor: string | undefined) {
  const segredo = process.env.CONVITE_COOKIE_SECRET;
  if (!valor || !segredo) return false;

  const partes = valor.split('.');
  if (partes.length !== 3 || partes[0] !== 'v1') return false;

  const exp = Number(partes[1]);
  if (!Number.isFinite(exp) || exp * 1000 < Date.now()) return false;

  return igualTempoConstante(partes[2], await assina(`v1.${exp}`, segredo));
}

/** URL do teaser. So existe no servidor; so vai para quem passou pelo codigo. */
export function teaserEmbed() {
  const url = process.env.CONVITE_TEASER_EMBED?.trim();
  return url && /^https:\/\//.test(url) ? url : null;
}
