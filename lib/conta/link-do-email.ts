import { destinoSeguro } from '@/lib/rotas';

/**
 * Regras do link de e-mail com `token_hash` (#348), num lugar so: o callback
 * (que so repassa) e a acao de /auth/continuar (que verifica) leem daqui.
 * Puras, sem Next e sem Supabase.
 */

const TIPOS = ['signup', 'recovery', 'email', 'email_change', 'magiclink', 'invite'] as const;
export type TipoDeLink = (typeof TIPOS)[number];

export const REDEFINIR = '/redefinir-senha';

export function ehTipoDeLink(tipo: unknown): tipo is TipoDeLink {
  return typeof tipo === 'string' && (TIPOS as readonly string[]).includes(tipo);
}

/**
 * Formato do hash: hex, as vezes com o prefixo `pkce_`. A checagem nao prova
 * nada (quem prova e o Supabase); so evita levar lixo ate ele e para a tela.
 */
const FORMATO_DO_HASH = /^[A-Za-z0-9_-]{16,128}$/;

export function ehHashDeLink(valor: unknown): valor is string {
  return typeof valor === 'string' && FORMATO_DO_HASH.test(valor);
}

/**
 * Para onde a pessoa vai depois do link. Recuperacao vai sempre para a
 * redefinicao, qualquer que seja o `next`: o link existe para isso, e um
 * `next` escolhido por quem montou o link (o checkout, por exemplo) e o que
 * transformaria um link alheio em compra na conta errada. O resto passa por
 * `destinoSeguro`, que so aceita rota de conta.
 */
export function destinoDoLink(tipo: TipoDeLink, next: string | null | undefined) {
  return tipo === 'recovery' ? REDEFINIR : destinoSeguro(next);
}
